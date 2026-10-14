import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_CHARS,
  chunkHash,
  chunkSection,
  renderGeminiChunkText,
  speechDurationPlausible,
  ttsDelivery,
} from "@/lib/pipeline/chunker";
import type { Segment } from "@/lib/pipeline/schemas";

const seg = (text: string, pauseAfterMs: number, breathBefore = false): Segment => ({
  text,
  pauseAfterMs,
  breathBefore,
});
const sentence = (n: number, length = 120) =>
  `${`Phrase numéro ${n} qui explique une idée. `.repeat(10)}`.slice(0, length - 1).trim() + ".";

describe("chunkSection", () => {
  it("coupe après chaque grande pause et en fin de section", () => {
    const chunks = chunkSection([
      seg("Bonjour.", 400),
      seg("On commence doucement.", 1500),
      seg("Première idée.", 500),
      seg("Elle se précise.", 1200),
      seg("Pour finir.", 3000),
    ]);
    expect(chunks.map((c) => c.caption)).toEqual([
      "Bonjour. On commence doucement.",
      "Première idée. Elle se précise.",
      "Pour finir.",
    ]);
    expect(chunks.map((c) => c.pauseAfterMs)).toEqual([1500, 1200, 3000]);
  });

  it("garde le silence de fin de section même s'il est court", () => {
    const chunks = chunkSection([seg("Un.", 300), seg("Deux.", 450)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pauseAfterMs).toBe(450);
  });

  it("coupe un long passage au segment portant la plus longue pause", () => {
    const segments = [
      seg(sentence(1, 200), 300),
      seg(sentence(2, 200), 700),
      seg(sentence(3, 200), 400),
      seg(sentence(4, 200), 350),
      seg(sentence(5, 200), 300),
      seg(sentence(6, 200), 3000),
    ];
    const chunks = chunkSection(segments);
    expect(chunks.length).toBeGreaterThan(1);
    // La première coupe tombe après le segment 2 (700 ms), pas au hasard.
    expect(chunks[0]?.segments).toHaveLength(2);
    expect(chunks[0]?.pauseAfterMs).toBe(700);
    for (const c of chunks) expect(c.caption.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("ne perd ni ne réordonne aucun segment, et ne coupe jamais une phrase", () => {
    const segments = Array.from({ length: 40 }, (_, i) =>
      seg(
        sentence(i, 60 + ((i * 37) % 300)),
        [300, 650, 1300, 500, 2000][i % 5] ?? 300,
        i % 6 === 0,
      ),
    );
    const chunks = chunkSection(segments);
    expect(chunks.flatMap((c) => c.segments)).toEqual(segments);
    for (const c of chunks) {
      expect(c.caption.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(c.caption.endsWith(".")).toBe(true);
      // Aucune grande pause ne reste à l'intérieur d'un chunk.
      for (const s of c.segments.slice(0, -1)) expect(s.pauseAfterMs).toBeLessThan(1000);
    }
  });

  it("renvoie une liste vide pour un script vide", () => {
    expect(chunkSection([])).toEqual([]);
  });
});

describe("renderGeminiChunkText", () => {
  it("applique espaces, <short pause> et <breath> selon le tableau de la spec", () => {
    const text = renderGeminiChunkText([
      seg("Installe-toi.", 400),
      seg("Respire.", 600),
      seg("On y va.", 999, true),
      seg("Fin.", 2000),
    ]);
    expect(text).toBe("Installe-toi. Respire. <short pause> <breath> On y va. <short pause> Fin.");
  });

  it("ne rend jamais la pause finale : c'est FFmpeg qui insère le silence", () => {
    expect(renderGeminiChunkText([seg("Seul.", 3000)])).toBe("Seul.");
  });
});

describe("chunkHash", () => {
  it("change avec le modèle, la voix, le style ou le texte", () => {
    const base = chunkHash("m", "v", "whispering", "Bonjour.");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(chunkHash("m", "v", "whispering", "Bonjour.")).toBe(base);
    for (const other of [
      chunkHash("m2", "v", "whispering", "Bonjour."),
      chunkHash("m", "v2", "whispering", "Bonjour."),
      chunkHash("m", "v", "soft and calm", "Bonjour."),
      chunkHash("m", "v", "whispering", "Bonsoir."),
    ]) {
      expect(other).not.toBe(base);
    }
  });

  it("donne à une prise refaite un hash propre au cours", () => {
    const base = chunkHash("m", "v", "whispering", "Bonjour.");
    const take = chunkHash("m", "v", "whispering", "Bonjour.", "course-a:1");
    expect(take).not.toBe(base);
    expect(chunkHash("m", "v", "whispering", "Bonjour.", "course-a:2")).not.toBe(take);
    expect(chunkHash("m", "v", "whispering", "Bonjour.", "course-b:1")).not.toBe(take);
  });
});

describe("ttsDelivery", () => {
  it("porte le mode par le style en Express, par une balise en Éco", () => {
    expect(ttsDelivery("whisper", "express")).toEqual({ style: "whispering", tag: "" });
    expect(ttsDelivery("soft", "express")).toEqual({ style: "soft and calm", tag: "" });
    expect(ttsDelivery("whisper", "eco")).toEqual({ style: "", tag: "<whispers> " });
    // Aucune balise ne dit « doux » : en Éco, ce mode repose sur la voix seule.
    expect(ttsDelivery("soft", "eco")).toEqual({ style: "", tag: "" });
  });
});

describe("speechDurationPlausible", () => {
  it("accepte un débit de parole normal, lent ou rapide", () => {
    expect(speechDurationPlausible(240, 20_000)).toBe(true);
    expect(speechDurationPlausible(240, 40_000)).toBe(true);
    expect(speechDurationPlausible(240, 10_000)).toBe(true);
  });

  it("rejette un passage tronqué, vide ou parti en roue libre", () => {
    expect(speechDurationPlausible(240, 3_000)).toBe(false);
    expect(speechDurationPlausible(240, 0)).toBe(false);
    expect(speechDurationPlausible(240, 120_000)).toBe(false);
  });

  it("ne juge pas le débit d'un passage très court", () => {
    expect(speechDurationPlausible(8, 300)).toBe(true);
    expect(speechDurationPlausible(8, 4_000)).toBe(true);
  });
});
