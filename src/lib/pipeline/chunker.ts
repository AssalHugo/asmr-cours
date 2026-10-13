import { createHash } from "node:crypto";
import type { TtsTier, VoiceMode } from "@/lib/estimate";
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

export type TtsDelivery = {
  /** Style par tour (`speech_metadata`) ; vide quand il n'est pas exprimable. */
  style: string;
  /** Balise placée en tête du texte, quand le style ne peut pas voyager autrement. */
  tag: string;
};

/**
 * Manière de porter le mode jusqu'à la voix. Le Batch API (Éco) parle generateContent, qui
 * n'a pas de style par tour : le chuchoté y passe par une balise, le mode doux repose sur
 * la voix seule. Un cours Éco garde cette forme même quand un chunk retombe sur l'API
 * standard, pour qu'un même cours ne mélange jamais deux rendus.
 */
export function ttsDelivery(mode: VoiceMode, tier: TtsTier): TtsDelivery {
  if (tier === "express") return { style: TTS_STYLE[mode], tag: "" };
  return { style: "", tag: mode === "whisper" ? "<whispers> " : "" };
}

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

/**
 * Clé de cache TTS : un chunk inchangé n'est jamais refacturé. `take` désigne une nouvelle
 * prise d'un passage refait (`courseId:n`) : elle est propre au cours, la prise d'origine
 * reste partagée.
 */
export function chunkHash(
  model: string,
  voiceId: string,
  style: string,
  text: string,
  take?: string,
): string {
  const parts = [model, voiceId, style, text];
  if (take) parts.push(`take:${take}`);
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Durée plausible d'une synthèse : le modèle peut tronquer un passage ou partir en roue
 * libre. Bornes larges (5 à 28 caractères par seconde), pour ne rejeter que l'aberrant.
 */
export const SPEECH_RATE_BOUNDS = { minCharsPerSecond: 5, maxCharsPerSecond: 28, graceMs: 3000 };

export function speechDurationPlausible(spokenChars: number, durationMs: number): boolean {
  const { minCharsPerSecond, maxCharsPerSecond, graceMs } = SPEECH_RATE_BOUNDS;
  if (durationMs <= 0) return false;
  // Un passage très court ne dit rien du débit.
  const tooShort = spokenChars >= 40 && durationMs < (spokenChars / maxCharsPerSecond) * 1000;
  const tooLong = durationMs > (spokenChars / minCharsPerSecond) * 1000 + graceMs;
  return !tooShort && !tooLong;
}
