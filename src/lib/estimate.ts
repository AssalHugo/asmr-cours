import { costUsd, MOCK_MODEL, type BillingTier } from "./pricing";

export type VoiceMode = "whisper" | "soft";
export type TtsTier = "eco" | "express";
export type TtsQuality = "standard" | "economy";
export type SourceKind = "pdf" | "images" | "text";

/** Débit par défaut, en caractères de source par seconde d'audio final. */
export const DEFAULT_RATE: Record<VoiceMode, number> = { whisper: 12, soft: 13.5 };
export const CHARS_PER_TOKEN = 3.5;
/** Tokens facturés par page de PDF ou par image envoyée à Gemini. */
export const TOKENS_PER_PAGE = 258;
/** Nombre de cours mesurés à partir duquel le débit observé remplace le défaut. */
export const MIN_MEASURED_COURSES = 3;

/** Hypothèses de l'estimation des étapes texte, regroupées pour être ajustées. */
const TEXT = {
  sectionChars: 4000,
  promptOverheadTokens: 600,
  /** Le script fait 0,9 à 1,4 fois la source, plus l'enveloppe JSON. */
  scriptRatio: 1.15,
  jsonOverhead: 1.25,
  /** Part de thinking résiduel au niveau le plus bas. */
  thinkingRatio: 0.15,
  /** Relances de réécriture après contrôle de fidélité. */
  retryMargin: 1.2,
  verifyOutputTokens: 200,
};

export type EstimateModels = { text: string; check: string; tts: string; ttsLite: string };

export type EstimateInput = {
  sourceChars: number;
  sourceKind: SourceKind;
  /** Pages du PDF ou nombre d'images. */
  pages?: number;
  mode: VoiceMode;
  /** Cours terminés avec la même voix et le même mode. */
  measured?: { sourceChars: number; durationMs: number }[];
  models: EstimateModels;
  at: Date;
  mock?: boolean;
};

export type ComboKey = `${TtsTier}-${TtsQuality}`;
export type ComboEstimate = {
  tier: TtsTier;
  quality: TtsQuality;
  ttsUsd: number;
  totalUsd: number;
};
export type CourseEstimate = {
  durationSec: number;
  rate: number;
  rateIsMeasured: boolean;
  textUsd: number;
  combos: Record<ComboKey, ComboEstimate>;
};

export const comboKey = (tier: TtsTier, quality: TtsQuality): ComboKey => `${tier}-${quality}`;
export const billingTier = (tier: TtsTier): BillingTier => (tier === "eco" ? "batch" : "standard");

export function speechRate(mode: VoiceMode, measured: EstimateInput["measured"] = []) {
  const usable = measured.filter((m) => m.sourceChars > 0 && m.durationMs > 0);
  if (usable.length < MIN_MEASURED_COURSES) return { rate: DEFAULT_RATE[mode], measured: false };
  const rates = usable.map((m) => m.sourceChars / (m.durationMs / 1000));
  return { rate: rates.reduce((a, b) => a + b, 0) / rates.length, measured: true };
}

const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** Coût estimé des étapes texte : extraction, réécriture, contrôle de fidélité. */
export function estimateTextUsd(input: EstimateInput): number {
  const { sourceChars, models, at } = input;
  const sections = Math.max(1, Math.ceil(sourceChars / TEXT.sectionChars));
  const source = tokens(sourceChars);
  const script = Math.ceil(source * TEXT.scriptRatio * TEXT.jsonOverhead);
  const thinking = (out: number) => Math.ceil(out * TEXT.thinkingRatio);
  const pageTokens = input.sourceKind === "text" ? 0 : (input.pages ?? 0) * TOKENS_PER_PAGE;

  const extract = costUsd(
    models.text,
    "standard",
    {
      inputTokens: (input.sourceKind === "text" ? source : pageTokens) + TEXT.promptOverheadTokens,
      outputTokens: Math.ceil(source * TEXT.jsonOverhead),
      thinkingTokens: thinking(source),
      audioSeconds: 0,
    },
    at,
  );
  const rewrite = costUsd(
    models.text,
    "standard",
    {
      inputTokens: source + sections * TEXT.promptOverheadTokens,
      outputTokens: script,
      thinkingTokens: thinking(script),
      audioSeconds: 0,
    },
    at,
  );
  const verify = costUsd(
    models.check,
    "standard",
    {
      inputTokens: source + script + sections * TEXT.promptOverheadTokens,
      outputTokens: sections * TEXT.verifyOutputTokens,
      thinkingTokens: sections * TEXT.verifyOutputTokens,
      audioSeconds: 0,
    },
    at,
  );
  return extract + (rewrite + verify) * TEXT.retryMargin;
}

/** Durée et coût d'un cours pour les 4 combinaisons Éco/Express × Standard/Économie. */
export function estimateCourse(input: EstimateInput): CourseEstimate {
  const models: EstimateModels = input.mock
    ? { text: MOCK_MODEL, check: MOCK_MODEL, tts: MOCK_MODEL, ttsLite: MOCK_MODEL }
    : input.models;
  const { rate, measured } = speechRate(input.mode, input.measured);
  const durationSec = input.sourceChars / rate;
  const textUsd = estimateTextUsd({ ...input, models });
  const ttsInputTokens = tokens(input.sourceChars * TEXT.scriptRatio);

  const combos = {} as Record<ComboKey, ComboEstimate>;
  for (const tier of ["eco", "express"] as const) {
    for (const quality of ["standard", "economy"] as const) {
      const ttsUsd = costUsd(
        quality === "standard" ? models.tts : models.ttsLite,
        billingTier(tier),
        {
          inputTokens: ttsInputTokens,
          outputTokens: 0,
          thinkingTokens: 0,
          audioSeconds: durationSec,
        },
        input.at,
      );
      combos[comboKey(tier, quality)] = { tier, quality, ttsUsd, totalUsd: ttsUsd + textUsd };
    }
  }
  return { durationSec, rate, rateIsMeasured: measured, textUsd, combos };
}
