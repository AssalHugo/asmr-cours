import type { SpendBreakdownRow } from "@/lib/admin";
import { formatCount, formatDuration, formatUsd } from "@/lib/format";
import { stepLabel, TIER_LABEL } from "./labels";

/** Dépense par étape et par modèle, avec les volumes facturés. */
export function SpendBreakdown({ rows }: { rows: SpendBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">Aucune dépense enregistrée.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const tokens = row.inputTokens + row.outputTokens + row.thinkingTokens;
        return (
          <li
            key={`${row.step}-${row.model}-${row.tier}`}
            className="bg-card flex items-start justify-between gap-4 rounded-2xl p-4"
          >
            <div className="min-w-0">
              <p>
                {stepLabel(row.step)}
                <span className="text-muted-foreground"> · {TIER_LABEL[row.tier] ?? row.tier}</span>
              </p>
              <p className="text-muted-foreground truncate text-sm">{row.model}</p>
              <p className="text-muted-foreground tabular text-sm">
                {row.events} appel{row.events > 1 ? "s" : ""}
                {tokens > 0 ? ` · ${formatCount(tokens)} tokens` : ""}
                {row.thinkingTokens > 0
                  ? ` (dont ${formatCount(row.thinkingTokens)} de réflexion)`
                  : ""}
                {row.audioSeconds > 0
                  ? ` · ${formatDuration(row.audioSeconds * 1000)} de voix`
                  : ""}
              </p>
            </div>
            <p className="tabular shrink-0">{formatUsd(row.costUsd, 3)}</p>
          </li>
        );
      })}
    </ul>
  );
}
