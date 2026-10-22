"use client";

import { Choice } from "@/components/choice";
import { Slider } from "@/components/ui/slider";
import { VoicePreviewButton } from "@/components/voice-preview-button";
import { AMBIENCE_GAIN_RANGE, AMBIENCES, getAmbience } from "@/lib/ambiences";
import {
  comboKey,
  type ComboEstimate,
  type ComboKey,
  type TtsQuality,
  type TtsTier,
  type VoiceMode,
} from "@/lib/estimate";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type VoiceOption = { id: string; label: string; description: string | null };

/** Réglages d'écoute d'un cours, hors vitesse et qualité. */
export type ListeningSettings = {
  mode: VoiceMode;
  voiceId: string;
  ambience: string;
  ambienceGainDb: number;
  addressForm: "tu" | "vous";
  quiz: boolean;
};

/** Réglages d'écoute de départ : ceux du profil, la voix par défaut si elle existe encore. */
export function initialListening(props: {
  voices: VoiceOption[];
  defaults: {
    voiceId: string | null;
    mode: VoiceMode;
    ambience: string;
    addressForm: "tu" | "vous";
  };
}): ListeningSettings {
  const ambience = getAmbience(props.defaults.ambience)?.id ?? "rain";
  return {
    mode: props.defaults.mode,
    voiceId:
      props.voices.find((v) => v.id === props.defaults.voiceId)?.id ?? props.voices[0]?.id ?? "",
    ambience,
    ambienceGainDb: getAmbience(ambience)?.defaultGainDb ?? -6,
    addressForm: props.defaults.addressForm,
    quiz: true,
  };
}

/** Façon de parler, voix, ambiance, forme d'adresse et quiz : l'assistant et les classeurs. */
export function CourseSettingsFields({
  voices,
  value,
  onChange,
}: {
  voices: VoiceOption[];
  value: ListeningSettings;
  onChange: (next: ListeningSettings) => void;
}) {
  const set = <K extends keyof ListeningSettings>(key: K, next: ListeningSettings[K]) =>
    onChange({ ...value, [key]: next });
  const { mode, voiceId, ambience, ambienceGainDb: gainDb, addressForm, quiz } = value;

  return (
    <>
      <Choice
        legend="Façon de parler"
        name="mode"
        value={mode}
        onChange={(next) => set("mode", next)}
        options={[
          { value: "whisper", label: "Chuchoté", hint: "Tout bas, très proche" },
          { value: "soft", label: "Doux", hint: "Voix posée, un peu plus rapide" },
        ]}
      />

      <fieldset className="space-y-3">
        <legend className="text-muted-foreground text-sm">Voix</legend>
        {voices.map((voice) => (
          <div
            key={voice.id}
            className={cn(
              "bg-card flex items-center gap-3 rounded-2xl p-3 pl-4 ring-1 ring-transparent",
              voice.id === voiceId && "bg-raised ring-sand ring-2",
            )}
          >
            <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="voice"
                value={voice.id}
                checked={voice.id === voiceId}
                onChange={() => set("voiceId", voice.id)}
                className="accent-sand size-5"
              />
              <span>{voice.label}</span>
            </label>
            <VoicePreviewButton voiceId={voice.id} mode={mode} label="Écouter la voix" />
          </div>
        ))}
      </fieldset>

      <Choice
        legend="Ambiance"
        name="ambience"
        value={ambience}
        columns={3}
        onChange={(id) =>
          onChange({ ...value, ambience: id, ambienceGainDb: getAmbience(id)?.defaultGainDb ?? -6 })
        }
        options={AMBIENCES.map((a) => ({ value: a.id, label: a.label }))}
      />
      <label className="block space-y-3">
        <span className="text-muted-foreground flex justify-between text-sm">
          <span>Niveau de l&apos;ambiance</span>
          <span className="tabular">
            {gainDb > 0 ? "+" : ""}
            {gainDb} dB
          </span>
        </span>
        <Slider
          value={[gainDb]}
          min={AMBIENCE_GAIN_RANGE.min}
          max={AMBIENCE_GAIN_RANGE.max}
          step={1}
          onValueChange={([next]) => set("ambienceGainDb", next ?? gainDb)}
          aria-label="Niveau de l'ambiance"
        />
      </label>

      <Choice
        legend="Murmure te dit"
        name="address"
        value={addressForm}
        onChange={(next) => set("addressForm", next)}
        options={[
          { value: "tu", label: "Tu" },
          { value: "vous", label: "Vous" },
        ]}
      />

      <Choice
        legend="Quiz en fin de chapitre"
        name="quiz"
        value={quiz ? "on" : "off"}
        onChange={(next) => set("quiz", next === "on")}
        options={[
          { value: "on", label: "Pour réviser", hint: "2 ou 3 questions, le temps d'y penser" },
          { value: "off", label: "Pour s'endormir", hint: "Sans questions" },
        ]}
      />
    </>
  );
}

/** Les quatre combinaisons Éco/Express × Standard/Économie, avec leur coût. */
export function ComboPicker({
  combos,
  tier,
  quality,
  onChange,
  blocked,
  legend = "Vitesse et qualité",
  ecoHint = "Éco : moitié prix, prêt en quelques heures (jusqu'à 24 h).",
}: {
  combos: Record<ComboKey, Pick<ComboEstimate, "totalUsd">>;
  tier: TtsTier;
  quality: TtsQuality;
  onChange: (tier: TtsTier, quality: TtsQuality) => void;
  blocked: (tier: TtsTier, quality: TtsQuality) => boolean;
  legend?: string;
  ecoHint?: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-muted-foreground text-sm">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["eco", "express"] as const).flatMap((t) =>
          (["standard", "economy"] as const).map((q) => {
            const option = combos[comboKey(t, q)];
            const disabled = blocked(t, q);
            const selected = t === tier && q === quality;
            return (
              <label
                key={comboKey(t, q)}
                className={cn(
                  "bg-card flex min-h-24 cursor-pointer flex-col justify-between rounded-2xl p-4 ring-1 ring-transparent",
                  selected && "bg-raised ring-sand ring-2",
                  disabled && "cursor-not-allowed opacity-45",
                )}
              >
                <input
                  type="radio"
                  name="combo"
                  className="sr-only"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(t, q)}
                />
                <span>
                  {t === "eco" ? "Éco" : "Express"} · {q === "standard" ? "Standard" : "Économie"}
                </span>
                <span className="tabular text-sand text-xl">{formatUsd(option.totalUsd)}</span>
              </label>
            );
          }),
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {tier === "eco" ? ecoHint : "Express : prêt en quelques minutes, plein tarif."}{" "}
        {quality === "economy" ? "Économie : voix un peu moins fine, un tiers moins chère." : ""}
      </p>
    </fieldset>
  );
}
