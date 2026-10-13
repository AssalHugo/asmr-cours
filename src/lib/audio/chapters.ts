import type { Caption, Chapter } from "@/lib/pipeline/schemas";

export type TimedChunk = {
  sectionId: string;
  caption: string;
  /** Durée de l'audio du chunk, silences de bord retirés. */
  durationMs: number;
  pauseAfterMs: number;
};

export type Timeline = {
  chunks: { startMs: number; durationMs: number }[];
  sections: { sectionId: string; startMs: number; durationMs: number }[];
  captions: Caption[];
  totalMs: number;
};

/**
 * Place chunks et sections sur la piste à partir des durées mesurées. Fonction pure.
 * Chaque chunk est suivi de son silence ; une section dure jusqu'au début de la suivante.
 */
export function buildTimeline(chunks: readonly TimedChunk[]): Timeline {
  const placed: Timeline["chunks"] = [];
  const captions: Caption[] = [];
  const sections: Timeline["sections"] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const current = sections.at(-1);
    if (!current || current.sectionId !== chunk.sectionId) {
      sections.push({ sectionId: chunk.sectionId, startMs: cursor, durationMs: 0 });
    }
    placed.push({ startMs: cursor, durationMs: chunk.durationMs });
    captions.push({ startMs: cursor, endMs: cursor + chunk.durationMs, text: chunk.caption });
    cursor += chunk.durationMs + chunk.pauseAfterMs;
    const section = sections.at(-1);
    if (section) section.durationMs = cursor - section.startMs;
  }
  return { chunks: placed, sections, captions, totalMs: cursor };
}

export function buildChapters(
  sections: Timeline["sections"],
  titles: ReadonlyMap<string, string>,
): Chapter[] {
  return sections.map((s) => ({
    title: titles.get(s.sectionId) ?? "Chapitre",
    startMs: s.startMs,
    durationMs: s.durationMs,
  }));
}

/** Échappement FFMETADATA : `=`, `;`, `#`, `\` et saut de ligne. */
function escapeMeta(value: string): string {
  return value.replace(/[=;#\\\n]/g, (c) => (c === "\n" ? "\\\n" : `\\${c}`));
}

/** Fichier de chapitres au format FFMETADATA1. */
export function renderFfmetadata(title: string, chapters: readonly Chapter[]): string {
  const lines = [";FFMETADATA1", `title=${escapeMeta(title)}`];
  for (const chapter of chapters) {
    lines.push(
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${chapter.startMs}`,
      `END=${chapter.startMs + chapter.durationMs}`,
      `title=${escapeMeta(chapter.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}
