import { chunkSection } from "./chunker";
import { charProblems, scriptChars, type Script, type Segment } from "./schemas";

/** Bornes de longueur d'un passage réexpliqué, rapportées au passage d'origine. */
export const REEXPLAIN_MIN_RATIO = 0.8;
export const REEXPLAIN_MAX_RATIO = 3;
/** Un passage très court peut gagner un exemple complet : plafond plancher, en caractères. */
export const REEXPLAIN_MIN_CEILING = 900;

/** Segments du script de voisinage transmis au modèle, avant et après le passage. */
const CONTEXT_SEGMENTS = 2;

export type PassageRange = { start: number; count: number };

/**
 * Retrouve dans le script d'une section les segments d'un chunk, à partir de sa légende
 * et de son rang dans la section. Les chunks étant dérivés du script par `chunkSection`,
 * on rejoue le découpage. `null` si le script a changé depuis.
 */
export function locatePassage(
  segments: Segment[],
  caption: string,
  ordinal: number,
): PassageRange | null {
  const ranges: (PassageRange & { caption: string })[] = [];
  let start = 0;
  for (const plan of chunkSection(segments)) {
    ranges.push({ start, count: plan.segments.length, caption: plan.caption });
    start += plan.segments.length;
  }
  const exact = ranges[ordinal];
  const found = exact?.caption === caption ? exact : ranges.find((r) => r.caption === caption);
  return found ? { start: found.start, count: found.count } : null;
}

/** Passage et voisinage immédiat, pour que la reformulation s'enchaîne naturellement. */
export function passageContext(segments: Segment[], range: PassageRange) {
  const end = range.start + range.count;
  return {
    before: segments.slice(Math.max(0, range.start - CONTEXT_SEGMENTS), range.start),
    passage: segments.slice(range.start, end),
    after: segments.slice(end, end + CONTEXT_SEGMENTS),
  };
}

/**
 * Remplace le passage par sa reformulation. La pause qui suit le passage est conservée :
 * le découpage des passages suivants ne bouge pas, leur audio reste en cache.
 */
export function splicePassage(
  segments: Segment[],
  range: PassageRange,
  replacement: Segment[],
): Segment[] {
  const lastPause = segments[range.start + range.count - 1]?.pauseAfterMs;
  const placed = replacement.map((segment, index) =>
    index === replacement.length - 1 && lastPause !== undefined
      ? { ...segment, pauseAfterMs: lastPause }
      : segment,
  );
  return [
    ...segments.slice(0, range.start),
    ...placed,
    ...segments.slice(range.start + range.count),
  ];
}

/** Contrôles côté code d'une reformulation. Liste vide = reformulation acceptée. */
export function reexplainProblems(passage: Segment[], script: Script): string[] {
  const problems = charProblems(script);
  const original = scriptChars({ segments: passage });
  const chars = scriptChars(script);
  const min = Math.floor(original * REEXPLAIN_MIN_RATIO);
  const max = Math.max(REEXPLAIN_MIN_CEILING, Math.ceil(original * REEXPLAIN_MAX_RATIO));
  if (chars < min || chars > max) {
    problems.push(
      `Longueur de ${chars} caractères : elle doit rester entre ${min} et ${max} caractères.`,
    );
  }
  return problems;
}

/**
 * Passage visé par une marque « Je n'ai pas compris » : même légende, au plus près de
 * l'instant marqué. `null` si le passage a été réécrit depuis.
 */
export function findMarkedPassage<T extends { caption: string; start_ms: number | null }>(
  passages: readonly T[],
  mark: { caption: string; position_ms: number },
): T | null {
  let best: T | null = null;
  for (const passage of passages) {
    if (passage.caption !== mark.caption) continue;
    const distance = Math.abs((passage.start_ms ?? 0) - mark.position_ms);
    if (!best || distance < Math.abs((best.start_ms ?? 0) - mark.position_ms)) best = passage;
  }
  return best;
}
