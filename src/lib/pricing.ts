/**
 * Tarifs Gemini en USD par million de tokens (docs/SPEC.md §3.2).
 * Vérifiés sur https://ai.google.dev/gemini-api/docs/pricing le 2026-10-13.
 * Tout calcul de coût passe par ce module : les tarifs doublent au 01/01/2027.
 */

export type BillingTier = "standard" | "batch";
export type Rate = { input: number; output: number };
type Period = Record<BillingTier, Rate>;
type ModelPricing = { until2026: Period; from2027: Period };

/** Bascule tarifaire, en UTC. */
export const PRICE_CHANGE_AT = new Date(Date.UTC(2027, 0, 1));
export const AUDIO_TOKENS_PER_SECOND = 25;
/** Modèle des providers mock : toujours gratuit. */
export const MOCK_MODEL = "mock";

const rate = (input: number, output: number): Rate => ({ input, output });
const fixed = (period: Period): ModelPricing => ({ until2026: period, from2027: period });

export const PRICING: Readonly<Record<string, ModelPricing>> = {
  "gemini-3.8-flash": {
    until2026: { standard: rate(0.75, 3.75), batch: rate(0.375, 1.875) },
    from2027: { standard: rate(1.5, 7.5), batch: rate(0.75, 3.75) },
  },
  "gemini-3.5-flash-lite": fixed({ standard: rate(0.3, 2.5), batch: rate(0.15, 1.25) }),
  "gemini-3.8-flash-tts": {
    until2026: { standard: rate(0.5, 9), batch: rate(0.25, 4.5) },
    from2027: { standard: rate(1, 18), batch: rate(0.5, 9) },
  },
  "gemini-3.8-flash-lite-tts": {
    until2026: { standard: rate(0.5, 6), batch: rate(0.25, 3) },
    from2027: { standard: rate(1, 12), batch: rate(0.5, 6) },
  },
  [MOCK_MODEL]: fixed({ standard: rate(0, 0), batch: rate(0, 0) }),
};

export class UnknownModelPricingError extends Error {
  constructor(model: string) {
    super(`Aucun tarif connu pour le modèle « ${model} » : ajoute-le dans src/lib/pricing.ts.`);
    this.name = "UnknownModelPricingError";
  }
}

export function rateFor(model: string, tier: BillingTier, at: Date): Rate {
  const pricing = PRICING[model];
  if (!pricing) throw new UnknownModelPricingError(model);
  return (at.getTime() >= PRICE_CHANGE_AT.getTime() ? pricing.from2027 : pricing.until2026)[tier];
}

export type BillableUsage = {
  inputTokens: number;
  /** Tokens de sortie texte, hors thinking. Ignorés pour un appel audio. */
  outputTokens: number;
  /** Le thinking est facturé au tarif de sortie. */
  thinkingTokens: number;
  /** Audio généré : 25 tokens de sortie par seconde. */
  audioSeconds: number;
};

export const NO_USAGE: BillableUsage = {
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  audioSeconds: 0,
};

/** Coût d'un appel. Pour un appel audio, la sortie est comptée en secondes générées. */
export function costUsd(model: string, tier: BillingTier, usage: BillableUsage, at: Date): number {
  const { input, output } = rateFor(model, tier, at);
  const outputTokens =
    usage.audioSeconds > 0
      ? usage.audioSeconds * AUDIO_TOKENS_PER_SECOND
      : usage.outputTokens + usage.thinkingTokens;
  return (usage.inputTokens * input + outputTokens * output) / 1_000_000;
}

/** Vrai tant que la hausse du 01/01/2027 n'est pas passée (alerte des Réglages). */
export function priceIncreaseAhead(at: Date): boolean {
  return at.getTime() < PRICE_CHANGE_AT.getTime();
}
