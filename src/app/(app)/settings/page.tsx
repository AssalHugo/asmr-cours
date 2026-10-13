import { LogOut, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { BudgetGauge } from "@/components/budget/budget-gauge";
import { OfflineStorage } from "@/components/offline-storage";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import {
  billingModels,
  getMonthlySpend,
  getProfile,
  listCourseUsage,
  listVoices,
} from "@/lib/data";
import { formatDate, formatUsd } from "@/lib/format";
import { MOCK_MODEL, priceIncreaseAhead, rateFor } from "@/lib/pricing";

export const metadata: Metadata = { title: "Réglages" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [profile, spentUsd, usage, voices] = await Promise.all([
    getProfile(user.id),
    getMonthlySpend(),
    listCourseUsage(),
    listVoices(user.id),
  ]);
  const { models, mock } = billingModels();
  const now = new Date();
  const priced = [
    { label: "Lecture et écriture", model: models.text },
    { label: "Contrôle de fidélité", model: models.check },
    { label: "Voix Standard", model: models.tts },
    { label: "Voix Économie", model: models.ttsLite },
  ].filter((row) => row.model !== MOCK_MODEL);

  return (
    <main className="space-y-12">
      <PageHeader title="Réglages" />

      <section className="space-y-4">
        <h2 className="text-2xl">Budget du mois</h2>
        <BudgetGauge spentUsd={spentUsd} budgetUsd={Number(profile.monthly_budget_usd)} />
        {usage.length > 0 ? (
          <table className="tabular w-full text-sm">
            <caption className="sr-only">Coût estimé et coût réel de chaque cours</caption>
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-2 font-normal">Cours</th>
                <th className="py-2 text-right font-normal">Estimé</th>
                <th className="py-2 text-right font-normal">Réel</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((row) => (
                <tr key={row.courseId} className="border-border border-t">
                  <td className="py-3 pr-3">
                    {row.title}
                    <span className="text-muted-foreground block">{formatDate(row.createdAt)}</span>
                  </td>
                  <td className="py-3 text-right">
                    {row.estUsd === null ? "—" : formatUsd(row.estUsd, 3)}
                  </td>
                  <td className="py-3 text-right">{formatUsd(row.actualUsd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Tarifs en vigueur</h2>
        {mock ? (
          <p className="text-muted-foreground">
            Mode démonstration : la voix est un simple signal sonore et rien n&apos;est facturé.
          </p>
        ) : (
          <>
            {priceIncreaseAhead(now) ? (
              <p className="bg-card text-sand flex items-start gap-3 rounded-2xl p-4">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  Les tarifs de Gemini doublent le 1er janvier 2027. Un même cours coûtera deux fois
                  plus.
                </span>
              </p>
            ) : null}
            <table className="tabular w-full text-sm">
              <caption className="text-muted-foreground pb-2 text-left">
                En dollars par million de tokens (entrée / sortie). Une seconde de voix compte 25
                tokens.
              </caption>
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-2 font-normal">Usage</th>
                  <th className="py-2 text-right font-normal">Express</th>
                  <th className="py-2 text-right font-normal">Éco</th>
                </tr>
              </thead>
              <tbody>
                {priced.map((row) => {
                  const standard = rateFor(row.model, "standard", now);
                  const batch = rateFor(row.model, "batch", now);
                  return (
                    <tr key={row.label} className="border-border border-t">
                      <td className="py-3 pr-3">
                        {row.label}
                        <span className="text-muted-foreground block">{row.model}</span>
                      </td>
                      <td className="py-3 text-right">
                        {standard.input} / {standard.output}
                      </td>
                      <td className="py-3 text-right">
                        {batch.input} / {batch.output}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Par défaut pour un nouveau cours</h2>
        <SettingsForm
          voices={voices.map((v) => ({ id: v.id, label: v.label }))}
          initial={{
            displayName: profile.display_name ?? "",
            defaultVoiceId: profile.default_voice_id,
            defaultMode: profile.default_mode,
            defaultAmbience: profile.default_ambience,
            defaultTier: profile.default_tier,
            defaultQuality: profile.default_quality,
            addressForm: profile.address_form === "vous" ? "vous" : "tu",
            monthlyBudgetUsd: Number(profile.monthly_budget_usd),
          }}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Cet appareil</h2>
        <OfflineStorage />
        <ThemeToggle />
      </section>

      <section className="space-y-3">
        <p className="text-muted-foreground text-sm">Connectée en tant que {user.email}</p>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost" className="-ml-4">
            <LogOut aria-hidden />
            Se déconnecter
          </Button>
        </form>
      </section>
    </main>
  );
}
