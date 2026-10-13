import { createHash } from "node:crypto";
import type { VoiceMode } from "@/lib/estimate";
import type { Segment } from "./schemas";

/** Une pause au moins aussi longue devient un silence exact inséré par FFmpeg. */
export const HARD_PAUSE_MS = 1000;
/** En dessous, la pause est laissée au débit naturel de la voix. */
export const SHORT_PAUSE_MS = 600;
export const CHUNK_MAX_CHARS = 900;

export type ChunkPlan = {
  segments: Segment[];
  /** Texte sans balises, pour les sous-titres. */
  caption: string;
  /** Silence à insérer après le chunk. */
  pauseAfterMs: number;
};

/** Style par tour de parole : 4 mots au plus, sinon la voix dérive (§8.5, §17). */
export const TTS_STYLE: Record<VoiceMode, string> = {
  whisper: "whispering",
  soft: "soft and calm",
};

export const captionOf = (segments: Segment[]) => segments.map((s) => s.text.trim()).join(" ");

/**
 * Découpe le script d'une section en chunks de synthèse (§8.4). Fonction pure.
 * On coupe après chaque grande pause (≥ 1 000 ms) et en fin de section. Un passage sans
 * grande pause qui dépasserait 900 caractères est coupé au segment portant sa plus longue
 * pause. Les segments étant des phrases entières, on ne coupe jamais au milieu d'une phrase.
 */
export function chunkSection(segments: Segment[]): ChunkPlan[] {
  const chunks: ChunkPlan[] = [];
  let run: Segment[] = [];

  const flush = (count: number) => {
    const taken = run.slice(0, count);
    const last = taken.at(-1);
    if (!last) return;
    chunks.push({ segments: taken, caption: captionOf(taken), pauseAfterMs: last.pauseAfterMs });
    run = run.slice(count);
  };

  for (const segment of segments) {
    while (run.length > 0 && captionOf([...run, segment]).length > CHUNK_MAX_CHARS) {
      flush(longestPauseIndex(run) + 1);
    }
    run.push(segment);
    if (segment.pauseAfterMs >= HARD_PAUSE_MS) flush(run.length);
  }
  flush(run.length);
  return chunks;
}

/** Rang du segment portant la plus longue pause ; à égalité, le plus tardif (chunk plus plein). */
function longestPauseIndex(run: Segment[]): number {
  let best = 0;
  run.forEach((segment, index) => {
    if (segment.pauseAfterMs >= (run[best]?.pauseAfterMs ?? 0)) best = index;
  });
  return best;
}

/**
 * Texte envoyé à Gemini TTS pour un chunk. Les balises restent en anglais, même pour un
 * texte français : ce sont des événements vocaux, pas du texte lu.
 */
export function renderGeminiChunkText(segments: Segment[]): string {
  return segments
    .map((segment, index) => {
      const breath = segment.breathBefore ? "<breath> " : "";
      const isLast = index === segments.length - 1;
      const separator = isLast
        ? ""
        : segment.pauseAfterMs >= SHORT_PAUSE_MS
          ? " <short pause> "
          : " ";
      return `${breath}${segment.text.trim()}${separator}`;
    })
    .join("");
}

/** Clé de cache TTS : un chunk inchangé n'est jamais refacturé. */
export function chunkHash(model: string, voiceId: string, style: string, text: string): string {
  return createHash("sha256").update([model, voiceId, style, text].join("|")).digest("hex");
}
