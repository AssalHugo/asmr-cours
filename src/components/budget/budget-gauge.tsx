import { BUDGET_WARNING_RATIO } from "@/lib/budget";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Jauge du mois. Le suivi de l'app est une estimation : la console de facturation fait foi. */
export function BudgetGauge({ spentUsd, budgetUsd }: { spentUsd: number; budgetUsd: number }) {
  const ratio = budgetUsd > 0 ? spentUsd / budgetUsd : 1;
  const tone =
    ratio >= 1 ? "bg-destructive" : ratio > BUDGET_WARNING_RATIO ? "bg-sand" : "bg-lavender";
  return (
    <div className="bg-card space-y-4 rounded-3xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-heading tabular text-4xl">{formatUsd(spentUsd)}</p>
        <p className="text-muted-foreground tabular">sur {formatUsd(budgetUsd)}</p>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Budget du mois utilisé"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, ratio) * 100)}
      >
        <div
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${Math.min(100, Math.max(1, ratio * 100))}%` }}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        Dépense estimée ce mois-ci. La facture Google fait foi.
      </p>
    </div>
  );
}
