"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSettings } from "@/app/(app)/settings/actions";
import { Choice } from "@/components/choice";
import { Button } from "@/components/ui/button";
import { AMBIENCES } from "@/lib/ambiences";
import type { SettingsInput } from "@/lib/course-input";

export function SettingsForm({
  initial,
  voices,
}: {
  initial: SettingsInput;
  voices: { id: string; label: string }[];
}) {
  const [values, setValues] = useState(initial);
  const [budgetText, setBudgetText] = useState(String(initial.monthlyBudgetUsd));
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const budget = Number(budgetText.replace(",", "."));
    if (!Number.isFinite(budget) || budget < 0) {
      toast.error("Le budget doit être un montant en dollars.");
      return;
    }
    startTransition(async () => {
      const result = await saveSettings({ ...values, monthlyBudgetUsd: budget });
      if (result.ok) toast.success("Réglages enregistrés.");
      else toast.error(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <label className="block space-y-2">
        <span className="text-muted-foreground text-sm">Budget mensuel, en dollars</span>
        <input
          inputMode="decimal"
          value={budgetText}
          onChange={(event) => setBudgetText(event.target.value)}
          className="bg-card tabular h-14 w-full rounded-2xl px-4 text-lg"
        />
      </label>

      {voices.length > 0 ? (
        <Choice
          legend="Voix par défaut"
          name="default-voice"
          value={values.defaultVoiceId ?? voices[0]?.id ?? ""}
          onChange={(id) => set("defaultVoiceId", id)}
          options={voices.map((v) => ({ value: v.id, label: v.label }))}
        />
      ) : null}
      <Choice
        legend="Façon de parler"
        name="default-mode"
        value={values.defaultMode}
        onChange={(value) => set("defaultMode", value)}
        options={[
          { value: "whisper", label: "Chuchoté" },
          { value: "soft", label: "Doux" },
        ]}
      />
      <Choice
        legend="Ambiance"
        name="default-ambience"
        value={values.defaultAmbience}
        columns={3}
        onChange={(value) => set("defaultAmbience", value)}
        options={AMBIENCES.map((a) => ({ value: a.id, label: a.label }))}
      />
      <Choice
        legend="Vitesse"
        name="default-tier"
        value={values.defaultTier}
        onChange={(value) => set("defaultTier", value)}
        options={[
          { value: "eco", label: "Éco", hint: "Moitié prix, plus lent" },
          { value: "express", label: "Express", hint: "En quelques minutes" },
        ]}
      />
      <Choice
        legend="Qualité de la voix"
        name="default-quality"
        value={values.defaultQuality}
        onChange={(value) => set("defaultQuality", value)}
        options={[
          { value: "standard", label: "Standard" },
          { value: "economy", label: "Économie", hint: "Un tiers moins chère" },
        ]}
      />
      <Choice
        legend="Murmure te dit"
        name="default-address"
        value={values.addressForm}
        onChange={(value) => set("addressForm", value)}
        options={[
          { value: "tu", label: "Tu" },
          { value: "vous", label: "Vous" },
        ]}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Enregistrer les réglages
      </Button>
    </form>
  );
}
