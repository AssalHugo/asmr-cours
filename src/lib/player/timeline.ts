import type { Caption, Chapter } from "@/lib/pipeline/schemas";

export const SEEK_STEP_MS = 15_000;
/** Au-delà de ce délai dans un chapitre, « précédent » revient à son début. */
const RESTART_THRESHOLD_MS = 3000;

/** Rang du dernier élément dont le début est ≤ `ms` (recherche dichotomique), ou −1. */
function lastStartedIndex<T extends { startMs: number }>(items: readonly T[], ms: number): number {
  let low = 0;
  let high = items.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((items[mid]?.startMs ?? Infinity) <= ms) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export function chapterIndexAt(chapters: readonly Chapter[], ms: number): number {
  return Math.max(0, lastStartedIndex(chapters, ms));
}

export function nextChapterStart(chapters: readonly Chapter[], ms: number): number | null {
  return chapters[chapterIndexAt(chapters, ms) + 1]?.startMs ?? null;
}

/** « Chapitre précédent » : début du chapitre courant, ou du précédent si on vient d'y entrer. */
export function previousChapterStart(chapters: readonly Chapter[], ms: number): number {
  const index = chapterIndexAt(chapters, ms);
  const current = chapters[index];
  if (!current) return 0;
  if (ms - current.startMs > RESTART_THRESHOLD_MS || index === 0) return current.startMs;
  return chapters[index - 1]?.startMs ?? 0;
}

export function chapterEnd(chapters: readonly Chapter[], ms: number, durationMs: number): number {
  const current = chapters[chapterIndexAt(chapters, ms)];
  return current ? Math.min(durationMs, current.startMs + current.durationMs) : durationMs;
}

/** Sous-titre à afficher : celui du chunk en cours, gardé pendant le silence qui le suit. */
export function captionIndexAt(captions: readonly Caption[], ms: number): number {
  return lastStartedIndex(captions, ms);
}

export function clampSeek(ms: number, durationMs: number): number {
  return Math.min(Math.max(0, ms), Math.max(0, durationMs));
}

export const PLAYBACK_RATES = [0.8, 0.9, 1, 1.1, 1.2] as const;
export const clampRate = (rate: number) => Math.min(1.2, Math.max(0.8, rate));

/** Minuteur de sommeil. */
export const SLEEP_MINUTES = [15, 30, 45, 60] as const;
export const SLEEP_FADE_MS = 30_000;

export type SleepTimer =
  | { kind: "off" }
  /** Échéance en temps réel (horloge murale). */
  | { kind: "minutes"; endsAt: number }
  /** Échéance en position de lecture : la fin du chapitre courant. */
  | { kind: "chapter"; endMs: number };

/** Temps réel restant avant l'arrêt, en millisecondes. */
export function sleepRemainingMs(
  timer: SleepTimer,
  now: number,
  positionMs: number,
  rate: number,
): number | null {
  if (timer.kind === "off") return null;
  if (timer.kind === "minutes") return Math.max(0, timer.endsAt - now);
  return Math.max(0, (timer.endMs - positionMs) / rate);
}

/** Niveau du gain maître pendant le fondu des 30 dernières secondes (1 → 0). */
export function sleepGain(remainingMs: number | null): number {
  if (remainingMs === null || remainingMs >= SLEEP_FADE_MS) return 1;
  return Math.max(0, remainingMs / SLEEP_FADE_MS);
}

/** Courbes de crossfade equal-power : la puissance totale reste constante au raccord. */
export function equalPowerCurves(steps = 64): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(steps);
  const fadeOut = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    fadeIn[i] = Math.sin((t * Math.PI) / 2);
    fadeOut[i] = Math.cos((t * Math.PI) / 2);
  }
  return { fadeIn, fadeOut };
}

/** Curseur de volume (0 à 1) → gain, avec une courbe douce dans les bas niveaux. */
export const sliderToGain = (value: number) => Math.min(1, Math.max(0, value)) ** 2;

/** Reprise proposée si la position enregistrée vaut la peine d'être reprise. */
export function resumePosition(savedMs: number, durationMs: number): number | null {
  return savedMs > 15_000 && savedMs < durationMs - 30_000 ? savedMs : null;
}
