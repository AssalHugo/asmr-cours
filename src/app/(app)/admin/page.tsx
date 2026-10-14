import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { SpendBreakdown } from "@/components/admin/spend-breakdown";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/page-header";
import { getAdminOverview } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDate, formatDuration, formatMonth, formatUsd } from "@/lib/format";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/pipeline/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();
  const overview = await getAdminOverview();
  const globalBudget = env().GLOBAL_MONTHLY_BUDGET_USD;
  const peak = Math.max(...overview.months.map((m) => m.costUsd), 0.01);
  const ready = overview.statusCounts.ready ?? 0;
  const failed = overview.statusCounts.failed ?? 0;
  const statuses = [...STATUS_ORDER, "failed" as const].filter(
    (s) => (overview.statusCounts[s] ?? 0) > 0,
  );

  return (
    <main className="space-y-12">
      <div>
        <PageHeader
          title="Admin"
          lead="Tous les comptes, tous les cours. Les montants sont ceux calculés par l'app : la facture Google fait foi."
        />
        <AdminTabs current="/admin" />
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Ce mois-ci"
            value={formatUsd(overview.monthUsd)}
            hint={globalBudget ? `sur ${formatUsd(globalBudget)} (plafond global)` : undefined}
          />
          <StatTile label="Depuis le début" value={formatUsd(overview.totalUsd)} />
          <StatTile
            label="Cours"
            value={String(overview.totalCourses)}
            hint={`${ready} prêt${ready > 1 ? "s" : ""}${failed > 0 ? ` · ${failed} interrompu${failed > 1 ? "s" : ""}` : ""}`}
          />
          <StatTile
            label="Audio produit"
            value={overview.totalDurationMs > 0 ? formatDuration(overview.totalDurationMs) : "—"}
            hint={
              ready > 0 && overview.totalUsd > 0 && overview.totalDurationMs > 0
                ? `≈ ${formatUsd(overview.totalUsd / (overview.totalDurationMs / 3_600_000))} l'heure`
                : undefined
            }
          />
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl">Dépense par mois</h2>
        <div className="bg-card rounded-3xl p-5">
          <ol className="flex h-40 items-end gap-1.5" aria-label="Dépense des douze derniers mois">
            {overview.months.map((m) => (
              <li
                key={m.month}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                title={`${formatMonth(m.month)} : ${formatUsd(m.costUsd)}`}
              >
                <span className="sr-only">
                  {formatMonth(m.month)} : {formatUsd(m.costUsd)}
                </span>
                <div
                  aria-hidden
                  className={cn("w-full rounded-t-md", m.costUsd > 0 ? "bg-lavender" : "bg-muted")}
                  style={{ height: `${Math.max(2, (m.costUsd / peak) * 100)}%` }}
                />
              </li>
            ))}
          </ol>
          <div aria-hidden className="text-muted-foreground mt-2 flex gap-1.5 text-[0.65rem]">
            {overview.months.map((m, i) => (
              <span key={m.month} className="flex-1 text-center">
                {i % 3 === 2 || i === overview.months.length - 1 ? formatMonth(m.month) : ""}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Comptes</h2>
        <ul className="space-y-3">
          {overview.accounts.map((a) => {
            const ratio = a.budgetUsd ? a.monthUsd / a.budgetUsd : 0;
            return (
              <li key={a.id}>
                <Link
                  href={`/admin/courses?user=${a.id}`}
                  className="bg-card hover:bg-accent block space-y-3 rounded-3xl p-5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg">{a.displayName ?? a.email}</p>
                      {a.displayName ? (
                        <p className="text-muted-foreground truncate text-sm">{a.email}</p>
                      ) : null}
                    </div>
                    <ChevronRight
                      className="text-muted-foreground mt-1 size-5 shrink-0"
                      aria-hidden
                    />
                  </div>
                  <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Ce mois-ci</dt>
                    <dd className="text-right">
                      {formatUsd(a.monthUsd)}
                      {a.budgetUsd !== null ? (
                        <span className="text-muted-foreground"> / {formatUsd(a.budgetUsd)}</span>
                      ) : null}
                    </dd>
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="text-right">{formatUsd(a.totalUsd)}</dd>
                    <dt className="text-muted-foreground">Cours</dt>
                    <dd className="text-right">
                      {a.courses}
                      {a.failed > 0 ? (
                        <span className="text-destructive">
                          {" "}
                          · {a.failed} interrompu{a.failed > 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </dd>
                    <dt className="text-muted-foreground">Audio</dt>
                    <dd className="text-right">
                      {a.durationMs > 0 ? formatDuration(a.durationMs) : "—"}
                    </dd>
                    <dt className="text-muted-foreground">Dernière connexion</dt>
                    <dd className="text-right">
                      {a.lastSignInAt ? formatDate(a.lastSignInAt) : "jamais"}
                    </dd>
                  </dl>
                  {a.budgetUsd ? (
                    <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
                      <div
                        className={cn(
                          "h-full rounded-full",
                          ratio >= 1 ? "bg-destructive" : ratio > 0.8 ? "bg-sand" : "bg-lavender",
                        )}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {statuses.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-2xl">État des cours</h2>
          <ul className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <li key={s}>
                <Link
                  href={`/admin/courses?status=${s}`}
                  className={cn(
                    "bg-card hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm transition-colors",
                    s === "failed" && "text-destructive",
                  )}
                >
                  {STATUS_LABEL[s]}
                  <span className="tabular text-muted-foreground">{overview.statusCounts[s]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-2xl">Où part l&apos;argent</h2>
        <p className="text-muted-foreground text-sm">Depuis le début, par étape et par modèle.</p>
        <SpendBreakdown rows={overview.breakdown} />
      </section>
    </main>
  );
}
