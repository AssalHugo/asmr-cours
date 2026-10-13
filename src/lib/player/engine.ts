import type { Chapter } from "@/lib/pipeline/schemas";
import { AmbienceLoop } from "./ambience-loop";
import {
  initialPlayerState,
  playerReducer,
  type PlayerEvent,
  type PlayerPhase,
  type PlayerState,
} from "./machine";
import {
  chapterEnd,
  chapterIndexAt,
  clampRate,
  clampSeek,
  nextChapterStart,
  previousChapterStart,
  SEEK_STEP_MS,
  sleepGain,
  sleepRemainingMs,
  sliderToGain,
  type SleepTimer,
} from "./timeline";

const SOFT_PAUSE_SECONDS = 0.3;
const AMBIENCE_SWAP_SECONDS = 2;
const PERSIST_EVERY_MS = 10_000;

export type PlayerSources = {
  courseId: string;
  title: string;
  durationMs: number;
  chapters: Chapter[];
  voiceUrl: string;
  /** Pré-mix voix + ambiance, pour le mode écran verrouillé. */
  mixUrl: string;
  ambienceUrl: (id: string) => string;
  artworkUrl: string;
};

export type PlayerSnapshot = {
  phase: PlayerPhase;
  positionMs: number;
  durationMs: number;
  chapterIndex: number;
  rate: number;
  /** Curseurs de 0 à 1. */
  voiceLevel: number;
  ambienceLevel: number;
  ambienceId: string;
  ambienceReady: boolean;
  lockMode: boolean;
  sleep: SleepTimer;
  sleepRemainingMs: number | null;
  error: string | null;
};

export type PlayerOptions = {
  lockMode: boolean;
  ambienceId: string;
  positionMs: number;
  onPersist: (positionMs: number) => void;
};

type LegacyPitch = HTMLAudioElement & {
  webkitPreservesPitch?: boolean;
  mozPreservesPitch?: boolean;
};
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Moteur du lecteur (docs/SPEC.md §10).
 *
 * Mode normal : `<audio crossorigin>` → MediaElementAudioSourceNode → gain voix → gain maître.
 * La voix n'est jamais décodée en entier (une heure en Float32 pèserait des centaines de Mo) ;
 * seule l'ambiance, courte, est décodée et bouclée. Mode écran verrouillé (iOS suspend
 * Web Audio au verrouillage) : le pré-mix dans un `<audio>` simple, sans Web Audio.
 */
export class PlayerEngine {
  private state: PlayerState = initialPlayerState;
  private snapshot: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();

  private voiceEl: HTMLAudioElement | undefined;
  private mixEl: HTMLAudioElement | undefined;
  private ctx: AudioContext | undefined;
  private voiceGain: GainNode | undefined;
  private ambienceGain: GainNode | undefined;
  private master: GainNode | undefined;
  private loop: AmbienceLoop | undefined;
  private loopedAmbience: string | undefined;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();

  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private sleepTimer: ReturnType<typeof setInterval> | undefined;
  private lastPersist = 0;
  private pendingSeekMs: number | undefined;
  private destroyed = false;

  constructor(
    private readonly sources: PlayerSources,
    private readonly options: PlayerOptions,
  ) {
    this.snapshot = {
      phase: "idle",
      positionMs: clampSeek(options.positionMs, sources.durationMs),
      durationMs: sources.durationMs,
      chapterIndex: chapterIndexAt(sources.chapters, options.positionMs),
      rate: 1,
      voiceLevel: 1,
      ambienceLevel: 0.6,
      ambienceId: options.ambienceId,
      ambienceReady: false,
      lockMode: options.lockMode,
      sleep: { kind: "off" },
      sleepRemainingMs: null,
      error: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = (): PlayerSnapshot => this.snapshot;

  private update(patch: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private dispatch(event: PlayerEvent): void {
    this.state = playerReducer(this.state, event);
    if (this.state.phase !== this.snapshot.phase) this.update({ phase: this.state.phase });
    this.syncMediaSession();
  }

  private get active(): HTMLAudioElement | undefined {
    return this.snapshot.lockMode ? this.mixEl : this.voiceEl;
  }

  /** Crée les éléments audio. À appeler une fois, côté navigateur. */
  mount(): void {
    this.voiceEl = this.createElement(this.sources.voiceUrl, true);
    this.mixEl = this.createElement(this.sources.mixUrl, false);
    this.pendingSeekMs = this.snapshot.positionMs;
    this.dispatch({ type: "LOAD" });
    this.active?.load();
    this.bindMediaSession();
    window.addEventListener("pagehide", this.persistNow);
  }

  private createElement(src: string, forWebAudio: boolean): HTMLAudioElement {
    const el = document.createElement("audio");
    // Sans CORS, Web Audio lirait du silence : l'élément voix est toujours « anonymous ».
    if (forWebAudio) el.crossOrigin = "anonymous";
    // Le pré-mix ne se charge que si le mode écran verrouillé est actif.
    el.preload = forWebAudio !== this.snapshot.lockMode ? "metadata" : "none";
    el.src = src;
    el.preservesPitch = true;
    const legacy = el as LegacyPitch;
    legacy.webkitPreservesPitch = true;
    legacy.mozPreservesPitch = true;

    const mine = (handler: () => void) => () => {
      if (this.active === el && !this.destroyed) handler();
    };
    el.addEventListener(
      "loadedmetadata",
      mine(() => {
        if (this.pendingSeekMs !== undefined) {
          el.currentTime = this.pendingSeekMs / 1000;
          this.pendingSeekMs = undefined;
        }
        el.playbackRate = this.snapshot.rate;
        this.dispatch({ type: "READY" });
      }),
    );
    el.addEventListener(
      "playing",
      mine(() => this.dispatch({ type: "PLAYING" })),
    );
    el.addEventListener(
      "waiting",
      mine(() => this.dispatch({ type: "WAITING" })),
    );
    el.addEventListener(
      "timeupdate",
      mine(() => this.onTime(el)),
    );
    el.addEventListener(
      "pause",
      mine(() => {
        // Pause venue d'ailleurs (casque débranché, autre app) : l'état suit.
        if (this.state.phase === "playing" && !el.ended) this.dispatch({ type: "INTERRUPTED" });
      }),
    );
    el.addEventListener(
      "ended",
      mine(() => {
        this.dispatch({ type: "ENDED" });
        this.suspendGraph();
        this.persistNow();
      }),
    );
    el.addEventListener(
      "error",
      mine(() => {
        this.dispatch({ type: "ERROR" });
        this.update({
          error: navigator.onLine
            ? "La piste n'a pas pu être chargée. Réessaie dans un instant."
            : "Tu es hors-ligne, et ce cours n'est pas téléchargé sur cet appareil.",
        });
      }),
    );
    return el;
  }

  private onTime(el: HTMLAudioElement): void {
    const positionMs = Math.round(el.currentTime * 1000);
    const chapterIndex = chapterIndexAt(this.sources.chapters, positionMs);
    const chapterChanged = chapterIndex !== this.snapshot.chapterIndex;
    this.update({ positionMs, chapterIndex });
    if (chapterChanged) this.syncMediaSession(true);
    else this.syncPositionState();
    if (Date.now() - this.lastPersist > PERSIST_EVERY_MS && this.state.phase === "playing") {
      this.persistNow();
    }
  }

  private persistNow = (): void => {
    this.lastPersist = Date.now();
    this.options.onPersist(this.snapshot.positionMs);
  };

  // --- Graphe Web Audio -----------------------------------------------------

  /** Créé au premier geste de lecture : un AudioContext ne démarre pas sans geste utilisateur. */
  private ensureGraph(): AudioContext | undefined {
    if (this.ctx || !this.voiceEl) return this.ctx;
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return undefined;
    const ctx = new Ctor();
    this.master = ctx.createGain();
    this.voiceGain = ctx.createGain();
    this.ambienceGain = ctx.createGain();
    this.voiceGain.gain.value = sliderToGain(this.snapshot.voiceLevel);
    this.ambienceGain.gain.value = sliderToGain(this.snapshot.ambienceLevel);
    ctx.createMediaElementSource(this.voiceEl).connect(this.voiceGain);
    this.voiceGain.connect(this.master);
    this.ambienceGain.connect(this.master);
    this.master.connect(ctx.destination);
    // « suspended » ou « interrupted » (appel entrant sur iOS) pendant la lecture : on passe en pause.
    ctx.addEventListener("statechange", () => {
      if (ctx.state !== "running" && this.state.phase === "playing" && !this.pauseTimer) {
        this.voiceEl?.pause();
        this.dispatch({ type: "INTERRUPTED" });
      }
    });
    this.ctx = ctx;
    void this.startAmbience(this.snapshot.ambienceId, 0.5);
    return ctx;
  }

  private loadBuffer(ctx: AudioContext, id: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(id);
    if (!pending) {
      pending = fetch(this.sources.ambienceUrl(id))
        .then((res) => {
          if (!res.ok) throw new Error(`Ambiance indisponible (${res.status})`);
          return res.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data));
      pending.catch(() => this.buffers.delete(id));
      this.buffers.set(id, pending);
    }
    return pending;
  }

  private async startAmbience(id: string, fadeSeconds: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.ambienceGain) return;
    try {
      const buffer = await this.loadBuffer(ctx, id);
      if (this.destroyed || this.snapshot.ambienceId !== id || this.loopedAmbience === id) return;
      this.loop?.stop(fadeSeconds);
      this.loop = new AmbienceLoop(ctx, buffer, this.ambienceGain);
      this.loop.start(fadeSeconds);
      this.loopedAmbience = id;
      this.update({ ambienceReady: true });
    } catch {
      this.update({ ambienceReady: false });
    }
  }

  private rampMaster(target: number, seconds: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(target, now + seconds);
  }

  private suspendGraph(): void {
    if (this.ctx?.state === "running") void this.ctx.suspend().catch(() => undefined);
  }

  private currentSleepGain(): number {
    return sleepGain(this.snapshot.sleepRemainingMs);
  }

  // --- Commandes ------------------------------------------------------------

  async play(): Promise<void> {
    const el = this.active;
    if (!el) return;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    if (this.state.phase === "ended") el.currentTime = 0;
    this.update({ error: null });
    this.dispatch({ type: "PLAY" });
    try {
      if (!this.snapshot.lockMode) {
        const ctx = this.ensureGraph();
        if (ctx && ctx.state !== "running") await ctx.resume();
        if (this.master) this.master.gain.value = 0;
        this.rampMaster(this.currentSleepGain(), SOFT_PAUSE_SECONDS);
      }
      await el.play();
    } catch {
      this.dispatch({ type: "PAUSE" });
    }
  }

  pause(): void {
    const el = this.active;
    if (!el || this.state.phase === "paused") return;
    this.dispatch({ type: "PAUSE" });
    this.persistNow();
    if (this.snapshot.lockMode || !this.ctx) {
      el.pause();
      return;
    }
    // Pause douce : fondu de 300 ms avant d'arrêter l'élément et le contexte.
    this.rampMaster(0, SOFT_PAUSE_SECONDS);
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(
      () => {
        this.pauseTimer = undefined;
        el.pause();
        this.suspendGraph();
      },
      SOFT_PAUSE_SECONDS * 1000 + 30,
    );
  }

  toggle(): void {
    if (
      this.state.phase === "playing" ||
      (this.state.phase === "loading" && this.state.wantsPlay)
    ) {
      this.pause();
    } else {
      void this.play();
    }
  }

  seek(positionMs: number): void {
    const el = this.active;
    const target = clampSeek(positionMs, this.sources.durationMs);
    if (!el) return;
    if (el.readyState === 0) this.pendingSeekMs = target;
    else el.currentTime = target / 1000;
    this.dispatch({ type: "SEEK" });
    this.update({
      positionMs: target,
      chapterIndex: chapterIndexAt(this.sources.chapters, target),
    });
    this.syncMediaSession(true);
  }

  seekBy(deltaMs: number): void {
    this.seek(this.snapshot.positionMs + deltaMs);
  }

  nextChapter(): void {
    const target = nextChapterStart(this.sources.chapters, this.snapshot.positionMs);
    if (target !== null) this.seek(target);
  }

  previousChapter(): void {
    this.seek(previousChapterStart(this.sources.chapters, this.snapshot.positionMs));
  }

  setRate(rate: number): void {
    const value = clampRate(rate);
    for (const el of [this.voiceEl, this.mixEl]) if (el) el.playbackRate = value;
    this.update({ rate: value });
    this.syncPositionState();
  }

  setVoiceLevel(level: number): void {
    this.update({ voiceLevel: level });
    if (this.voiceGain && this.ctx) {
      this.voiceGain.gain.setTargetAtTime(sliderToGain(level), this.ctx.currentTime, 0.05);
    }
    if (this.mixEl) this.mixEl.volume = sliderToGain(level) * this.currentSleepGain();
  }

  setAmbienceLevel(level: number): void {
    this.update({ ambienceLevel: level });
    if (this.ambienceGain && this.ctx) {
      this.ambienceGain.gain.setTargetAtTime(sliderToGain(level), this.ctx.currentTime, 0.05);
    }
  }

  /** Changement d'ambiance à chaud : crossfade de 2 s entre l'ancienne et la nouvelle. */
  setAmbience(id: string): void {
    if (id === this.snapshot.ambienceId) return;
    this.update({ ambienceId: id, ambienceReady: false });
    void this.startAmbience(id, AMBIENCE_SWAP_SECONDS);
  }

  /** Bascule entre mix en direct (Web Audio) et pré-mix (écran verrouillé), sans perdre la position. */
  setLockMode(lockMode: boolean): void {
    if (lockMode === this.snapshot.lockMode) return;
    const wasPlaying = this.state.phase === "playing" || this.state.wantsPlay;
    const positionMs = this.snapshot.positionMs;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = undefined;
    this.active?.pause();
    this.suspendGraph();
    this.state = { phase: "paused", wantsPlay: false };
    this.update({ lockMode, phase: "paused" });

    const el = this.active;
    if (!el) return;
    if (el.readyState === 0) {
      this.pendingSeekMs = positionMs;
      el.load();
    } else {
      el.currentTime = positionMs / 1000;
    }
    el.playbackRate = this.snapshot.rate;
    if (wasPlaying) void this.play();
  }

  /** Minuteur de sommeil : `minutes`, `"chapter"` (fin du chapitre) ou `null` pour l'arrêter. */
  setSleep(choice: number | "chapter" | null): void {
    clearInterval(this.sleepTimer);
    this.sleepTimer = undefined;
    if (choice === null) {
      this.update({ sleep: { kind: "off" }, sleepRemainingMs: null });
      this.applySleepGain(1);
      return;
    }
    const sleep: SleepTimer =
      choice === "chapter"
        ? {
            kind: "chapter",
            endMs: chapterEnd(
              this.sources.chapters,
              this.snapshot.positionMs,
              this.sources.durationMs,
            ),
          }
        : { kind: "minutes", endsAt: Date.now() + choice * 60_000 };
    this.update({ sleep });
    this.tickSleep();
    this.sleepTimer = setInterval(() => this.tickSleep(), 500);
  }

  private tickSleep(): void {
    const remaining = sleepRemainingMs(
      this.snapshot.sleep,
      Date.now(),
      this.snapshot.positionMs,
      this.snapshot.rate,
    );
    this.update({ sleepRemainingMs: remaining });
    if (remaining === null) return;
    // Fondu de 30 s, puis pause.
    if (this.state.phase === "playing") this.applySleepGain(sleepGain(remaining));
    if (remaining <= 0) {
      clearInterval(this.sleepTimer);
      this.sleepTimer = undefined;
      this.update({ sleep: { kind: "off" }, sleepRemainingMs: null });
      const el = this.active;
      el?.pause();
      this.suspendGraph();
      this.dispatch({ type: "PAUSE" });
      this.persistNow();
      this.applySleepGain(1);
    }
  }

  private applySleepGain(gain: number): void {
    if (this.snapshot.lockMode) {
      // iOS ignore `volume` : le pré-mix s'y arrête sans fondu.
      if (this.mixEl) this.mixEl.volume = sliderToGain(this.snapshot.voiceLevel) * gain;
    } else if (this.master && this.ctx && !this.pauseTimer) {
      this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
    }
  }

  // --- Media Session --------------------------------------------------------

  private bindMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action non prise en charge par ce navigateur.
      }
    };
    bind("play", () => void this.play());
    bind("pause", () => this.pause());
    bind("seekbackward", (d) => this.seekBy(-(d.seekOffset ? d.seekOffset * 1000 : SEEK_STEP_MS)));
    bind("seekforward", (d) => this.seekBy(d.seekOffset ? d.seekOffset * 1000 : SEEK_STEP_MS));
    bind("previoustrack", () => this.previousChapter());
    bind("nexttrack", () => this.nextChapter());
    bind("seekto", (d) => {
      if (typeof d.seekTime === "number") this.seek(d.seekTime * 1000);
    });
    this.syncMediaSession(true);
  }

  private syncMediaSession(metadata = false): void {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (metadata && typeof MediaMetadata !== "undefined") {
      session.metadata = new MediaMetadata({
        title: this.sources.chapters[this.snapshot.chapterIndex]?.title ?? this.sources.title,
        artist: "Murmure",
        album: this.sources.title,
        artwork: [{ src: this.sources.artworkUrl, sizes: "512x512", type: "image/png" }],
      });
    }
    session.playbackState =
      this.state.phase === "playing" ? "playing" : this.state.phase === "idle" ? "none" : "paused";
    this.syncPositionState();
  }

  private syncPositionState(): void {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.sources.durationMs / 1000,
        position: Math.min(this.snapshot.positionMs, this.sources.durationMs) / 1000,
        playbackRate: this.snapshot.rate,
      });
    } catch {
      // Valeurs refusées (durée encore inconnue du navigateur).
    }
  }

  destroy(): void {
    this.persistNow();
    this.destroyed = true;
    clearTimeout(this.pauseTimer);
    clearInterval(this.sleepTimer);
    window.removeEventListener("pagehide", this.persistNow);
    for (const el of [this.voiceEl, this.mixEl]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    this.loop?.stop(0);
    void this.ctx?.close().catch(() => undefined);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
    this.listeners.clear();
  }
}

/** iOS et iPadOS suspendent Web Audio à l'écran verrouillé : le pré-mix y est le défaut. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
