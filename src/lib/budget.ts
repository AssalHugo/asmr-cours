import type { TtsTier } from "./estimate";

/** Part du budget au-delà de laquelle il faut confirmer, et où Express est désactivé. */
export const BUDGET_WARNING_RATIO = 0.8;

export type BudgetInput = {
  /** Dépense du mois (somme de usage_events). */
  spentUsd: number;
  /** Estimation du cours à lancer. */
  estimateUsd: number;
  budgetUsd: number;
  tier: TtsTier;
  /** L'utilisatrice a explicitement confirmé le dépassement des 80 %. */
  confirmed: boolean;
};

export type BudgetDecision =
  | { ok: true; warning: boolean; ratio: number; remainingUsd: number }
  | {
      ok: false;
      reason: "over_budget" | "express_disabled" | "needs_confirmation";
      message: string;
      ratio: number;
      remainingUsd: number;
    };

const usd = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

/**
 * Garde-fou budget (docs/SPEC.md §3.3). Évalué côté serveur, à la création du cours
 * puis de nouveau avant la synthèse, quand la taille réelle du script est connue.
 */
export function checkBudget(input: BudgetInput): BudgetDecision {
  const { spentUsd, estimateUsd, budgetUsd, tier, confirmed } = input;
  const projected = spentUsd + estimateUsd;
  const ratio = budgetUsd > 0 ? projected / budgetUsd : Number.POSITIVE_INFINITY;
  const remainingUsd = Math.max(0, budgetUsd - spentUsd);
  const base = { ratio, remainingUsd };

  if (projected > budgetUsd) {
    return {
      ok: false,
      reason: "over_budget",
      message: `Ce cours coûterait environ ${usd(estimateUsd)}, et il reste ${usd(remainingUsd)} sur le budget du mois (${usd(budgetUsd)}). Passe en Éco ou en qualité Économie, ou augmente le budget dans les réglages.`,
      ...base,
    };
  }
  const warning = ratio > BUDGET_WARNING_RATIO;
  if (warning && tier === "express") {
    return {
      ok: false,
      reason: "express_disabled",
      message:
        "Plus de 80 % du budget du mois serait engagé : le mode Express est désactivé. Choisis le mode Éco.",
      ...base,
    };
  }
  if (warning && !confirmed) {
    return {
      ok: false,
      reason: "needs_confirmation",
      message: `Avec ce cours, ${Math.round(ratio * 100)} % du budget du mois serait engagé. Confirme pour continuer.`,
      ...base,
    };
  }
  return { ok: true, warning, ...base };
}

/** Express reste-t-il proposable ? (pour griser l'option dans l'assistant) */
export function expressAllowed(spentUsd: number, expressEstimateUsd: number, budgetUsd: number) {
  return budgetUsd > 0 && (spentUsd + expressEstimateUsd) / budgetUsd <= BUDGET_WARNING_RATIO;
}
