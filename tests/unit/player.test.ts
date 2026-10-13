import { describe, expect, it } from "vitest";
import { initialPlayerState, playerReducer, type PlayerEvent } from "@/lib/player/machine";
import {
  captionIndexAt,
  chapterEnd,
  chapterIndexAt,
  clampRate,
  clampSeek,
  equalPowerCurves,
  nextChapterStart,
  previousChapterStart,
  resumePosition,
  sleepGain,
  sleepRemainingMs,
} from "@/lib/player/timeline";

const run = (...events: PlayerEvent["type"][]) =>
  events.reduce((state, type) => playerReducer(state, { type } as PlayerEvent), initialPlayerState);

describe("machine d'état du lecteur", () => {
  it("passe de idle à paused une fois le média prêt", () => {
    expect(run("LOAD").phase).toBe("loading");
    expect(run("LOAD", "READY").phase).toBe("paused");
  });
  it("retient une lecture demandée pendant le chargement", () => {
    expect(run("LOAD", "PLAY", "READY")).toEqual({ phase: "loading", wantsPlay: true });
    expect(run("LOAD", "PLAY", "READY", "PLAYING").phase).toBe("playing");
  });
  it("revient en chargement quand le tampon se vide, puis reprend", () => {
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "WAITING")).toEqual({
      phase: "loading",
      wantsPlay: true,
    });
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "WAITING", "PLAYING").phase).toBe("playing");
  });
  it("se met en pause sur demande ou sur interruption du système", () => {
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "PAUSE").phase).toBe("paused");
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "INTERRUPTED").phase).toBe("paused");
    // Un événement « playing » tardif ne relance pas une lecture mise en pause.
    expect(run("LOAD", "READY", "PLAY", "PAUSE", "PLAYING").phase).toBe("paused");
  });
  it("termine, puis repart après un retour en arrière", () => {
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "ENDED").phase).toBe("ended");
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "ENDED", "SEEK").phase).toBe("paused");
    expect(run("LOAD", "READY", "PLAY", "PLAYING", "ENDED", "PLAY").phase).toBe("loading");
  });
  it("ignore la lecture tant que rien n'est chargé, et retombe en idle sur erreur", () => {
    expect(run("PLAY").phase).toBe("idle");
    expect(run("LOAD", "READY", "ERROR")).toEqual(initialPlayerState);
  });
});

describe("chapitres et sous-titres", () => {
  const chapters = [
    { title: "A", startMs: 0, durationMs: 60_000 },
    { title: "B", startMs: 60_000, durationMs: 30_000 },
    { title: "C", startMs: 90_000, durationMs: 10_000 },
  ];
  const captions = [
    { startMs: 0, endMs: 4000, text: "un" },
    { startMs: 5500, endMs: 9000, text: "deux" },
  ];

  it("trouve le chapitre courant", () => {
    expect(chapterIndexAt(chapters, 0)).toBe(0);
    expect(chapterIndexAt(chapters, 59_999)).toBe(0);
    expect(chapterIndexAt(chapters, 60_000)).toBe(1);
    expect(chapterIndexAt(chapters, 999_999)).toBe(2);
    expect(chapterIndexAt([], 10)).toBe(0);
  });
  it("navigue vers le chapitre suivant et précédent", () => {
    expect(nextChapterStart(chapters, 10_000)).toBe(60_000);
    expect(nextChapterStart(chapters, 95_000)).toBeNull();
    // Bien entamé : retour au début du chapitre. Tout juste entré : chapitre d'avant.
    expect(previousChapterStart(chapters, 75_000)).toBe(60_000);
    expect(previousChapterStart(chapters, 61_000)).toBe(0);
    expect(previousChapterStart(chapters, 1000)).toBe(0);
    expect(chapterEnd(chapters, 61_000, 100_000)).toBe(90_000);
  });
  it("garde le sous-titre du chunk pendant le silence qui le suit", () => {
    expect(captionIndexAt(captions, 0)).toBe(0);
    expect(captionIndexAt(captions, 4800)).toBe(0);
    expect(captionIndexAt(captions, 5500)).toBe(1);
    expect(captionIndexAt([], 100)).toBe(-1);
  });
  it("borne les déplacements et la vitesse", () => {
    expect(clampSeek(-5000, 100_000)).toBe(0);
    expect(clampSeek(120_000, 100_000)).toBe(100_000);
    expect(clampRate(0.5)).toBe(0.8);
    expect(clampRate(2)).toBe(1.2);
  });
  it("ne propose la reprise que si elle a un sens", () => {
    expect(resumePosition(5000, 600_000)).toBeNull();
    expect(resumePosition(120_000, 600_000)).toBe(120_000);
    expect(resumePosition(590_000, 600_000)).toBeNull();
  });
});

describe("minuteur de sommeil et fondus", () => {
  it("compte en temps réel, ou jusqu'à la fin du chapitre selon la vitesse", () => {
    expect(sleepRemainingMs({ kind: "off" }, 0, 0, 1)).toBeNull();
    expect(sleepRemainingMs({ kind: "minutes", endsAt: 100_000 }, 40_000, 0, 1)).toBe(60_000);
    expect(sleepRemainingMs({ kind: "chapter", endMs: 90_000 }, 0, 60_000, 1.2)).toBe(25_000);
    expect(sleepRemainingMs({ kind: "minutes", endsAt: 10 }, 5000, 0, 1)).toBe(0);
  });
  it("fond le volume sur les 30 dernières secondes", () => {
    expect(sleepGain(null)).toBe(1);
    expect(sleepGain(45_000)).toBe(1);
    expect(sleepGain(15_000)).toBe(0.5);
    expect(sleepGain(0)).toBe(0);
  });
  it("garde une puissance constante pendant le crossfade", () => {
    const { fadeIn, fadeOut } = equalPowerCurves(33);
    expect(fadeIn[0]).toBe(0);
    expect(fadeOut[0]).toBe(1);
    fadeIn.forEach((value, i) => expect(value ** 2 + (fadeOut[i] ?? 0) ** 2).toBeCloseTo(1, 5));
  });
});
