"use client";

import { ArrowLeft, FileText, Images, Loader2, TextCursorInput, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createCourse, prepareSource, type PreparedSource } from "@/app/(app)/actions";
import { Choice } from "@/components/choice";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { uploadFiles, UploadError } from "@/components/upload/upload-files";
import { VoicePreviewButton } from "@/components/voice-preview-button";
import { AMBIENCE_GAIN_RANGE, AMBIENCES, getAmbience } from "@/lib/ambiences";
import { BUDGET_WARNING_RATIO, expressAllowed } from "@/lib/budget";
import {
  comboKey,
  estimateCourse,
  type EstimateModels,
  type TtsQuality,
  type TtsTier,
  type VoiceMode,
} from "@/lib/estimate";
import { formatDuration, formatUsd } from "@/lib/format";
import { UPLOAD_MIME } from "@/lib/uploads";
import { cn } from "@/lib/utils";

type SourceTab = "pdf" | "images" | "text";

export type WizardProps = {
  voices: { id: string; label: string; description: string | null }[];
  defaults: {
    voiceId: string | null;
    mode: VoiceMode;
    ambience: string;
    tier: TtsTier;
    quality: TtsQuality;
    addressForm: "tu" | "vous";
  };
  budget: { spentUsd: number; budgetUsd: number };
  models: EstimateModels;
  mock: boolean;
  measured: { voiceId: string; mode: VoiceMode; sourceChars: number; durationMs: number }[];
  limits: { maxUploadMb: number; maxPdfPages: number; maxSourceChars: number; maxImages: number };
};

const STEPS = ["Source", "Réglages", "Estimation"] as const;

export function NewCourseWizard(props: WizardProps) {
  const router = useRouter();
  const [step, setStepState] = useState(0);
  const setStep = (next: number) => {
    setStepState(next);
    window.scrollTo({ top: 0 });
  };
  const [prepared, setPrepared] = useState<PreparedSource | null>(null);

  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [mode, setMode] = useState<VoiceMode>(props.defaults.mode);
  const [voiceId, setVoiceId] = useState(
    props.voices.find((v) => v.id === props.defaults.voiceId)?.id ?? props.voices[0]?.id ?? "",
  );
  const [ambience, setAmbience] = useState(getAmbience(props.defaults.ambience)?.id ?? "rain");
  const [gainDb, setGainDb] = useState(getAmbience(ambience)?.defaultGainDb ?? -6);
  const [addressForm, setAddressForm] = useState(props.defaults.addressForm);
  const [tier, setTier] = useState<TtsTier>(props.defaults.tier);
  const [quality, setQuality] = useState<TtsQuality>(props.defaults.quality);
  const [confirmed, setConfirmed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useMemo(() => {
    if (!prepared) return null;
    return estimateCourse({
      sourceChars: prepared.sourceChars,
      sourceKind: prepared.kind,
      pages: prepared.pages,
      mode,
      measured: props.measured.filter((m) => m.voiceId === voiceId && m.mode === mode),
      models: props.models,
      at: new Date(),
      mock: props.mock,
    });
  }, [prepared, mode, voiceId, props.measured, props.models, props.mock]);

  const { spentUsd, budgetUsd } = props.budget;
  const combo = estimate?.combos[comboKey(tier, quality)];
  const ratio = combo && budgetUsd > 0 ? (spentUsd + combo.totalUsd) / budgetUsd : 0;
  const overBudget = combo ? spentUsd + combo.totalUsd > budgetUsd : false;
  const needsConfirmation = !overBudget && ratio > BUDGET_WARNING_RATIO;

  function onPrepared(source: PreparedSource) {
    setPrepared(source);
    if (!titleEdited) setTitle(source.title);
    setError(null);
    setStep(1);
  }

  async function launch() {
    if (!prepared) return;
    setLaunching(true);
    setError(null);
    const result = await createCourse({
      courseId: prepared.courseId,
      source: { kind: prepared.kind, keys: prepared.keys },
      title,
      // Un titre laissé tel quel sera remplacé par celui que propose l'extraction.
      titleIsDefault: !titleEdited && prepared.kind !== "text",
      mode,
      voiceId,
      ambience,
      ambienceGainDb: gainDb,
      addressForm,
      tier,
      quality,
      confirmed,
    });
    if (!result.ok) {
      setError(result.message);
      setLaunching(false);
      return;
    }
    toast.success("C'est lancé.");
    router.push(`/courses/${result.data.courseId}`);
  }

  return (
    <div className="space-y-8">
      <ol className="flex items-center gap-2" aria-label="Étapes">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex-1 border-t-2 pt-2 text-sm transition-colors",
              index === step
                ? "border-sand text-foreground"
                : index < step
                  ? "border-lavender text-muted-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? <SourceStep limits={props.limits} onPrepared={onPrepared} /> : null}

      {step === 1 && prepared ? (
        <form
          className="space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim().length === 0) return setError("Donne un titre à ce cours.");
            setError(null);
            setStep(2);
          }}
        >
          <label className="block space-y-2">
            <span className="text-muted-foreground text-sm">Titre</span>
            <input
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleEdited(true);
              }}
              className="bg-card h-14 w-full rounded-2xl px-4 text-lg"
            />
            {!titleEdited && prepared.kind !== "text" ? (
              <span className="text-muted-foreground block text-sm">
                Si tu le laisses, Murmure reprendra le titre qu&apos;il lit dans le cours.
              </span>
            ) : null}
          </label>

          <Choice
            legend="Façon de parler"
            name="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "whisper", label: "Chuchoté", hint: "Tout bas, très proche" },
              { value: "soft", label: "Doux", hint: "Voix posée, un peu plus rapide" },
            ]}
          />

          <fieldset className="space-y-3">
            <legend className="text-muted-foreground text-sm">Voix</legend>
            {props.voices.map((voice) => (
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
                    onChange={() => setVoiceId(voice.id)}
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
            onChange={(id) => {
              setAmbience(id);
              setGainDb(getAmbience(id)?.defaultGainDb ?? -6);
            }}
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
              onValueChange={([value]) => setGainDb(value ?? gainDb)}
              aria-label="Niveau de l'ambiance"
            />
          </label>

          <Choice
            legend="Murmure te dit"
            name="address"
            value={addressForm}
            onChange={setAddressForm}
            options={[
              { value: "tu", label: "Tu" },
              { value: "vous", label: "Vous" },
            ]}
          />

          {error ? <ErrorNote message={error} /> : null}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setStep(0)}
              aria-label="Changer de source"
            >
              <ArrowLeft aria-hidden />
            </Button>
            <Button type="submit" className="flex-1">
              Voir l&apos;estimation
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 && prepared && estimate && combo ? (
        <div className="space-y-8">
          <div className="space-y-1 text-center">
            <p className="text-muted-foreground text-sm">Durée estimée</p>
            <p className="font-heading text-5xl">
              {prepared.approximate ? "≈ " : ""}
              {formatDuration(estimate.durationSec * 1000)}
            </p>
            <p className="text-muted-foreground text-sm">
              {prepared.approximate
                ? "Estimation large : le texte de ce document n'est lisible qu'après analyse."
                : estimate.rateIsMeasured
                  ? "D'après tes cours précédents avec cette voix."
                  : `${prepared.sourceChars.toLocaleString("fr-FR")} caractères de cours.`}
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-muted-foreground text-sm">Vitesse et qualité</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["eco", "express"] as const).flatMap((t) =>
                (["standard", "economy"] as const).map((q) => {
                  const option = estimate.combos[comboKey(t, q)];
                  const blocked =
                    t === "express" &&
                    !expressAllowed(spentUsd, option.totalUsd, budgetUsd) &&
                    !props.mock;
                  const selected = t === tier && q === quality;
                  return (
                    <label
                      key={comboKey(t, q)}
                      className={cn(
                        "bg-card flex min-h-24 cursor-pointer flex-col justify-between rounded-2xl p-4 ring-1 ring-transparent",
                        selected && "bg-raised ring-sand ring-2",
                        blocked && "cursor-not-allowed opacity-45",
                      )}
                    >
                      <input
                        type="radio"
                        name="combo"
                        className="sr-only"
                        checked={selected}
                        disabled={blocked}
                        onChange={() => {
                          setTier(t);
                          setQuality(q);
                          setConfirmed(false);
                        }}
                      />
                      <span>
                        {t === "eco" ? "Éco" : "Express"} ·{" "}
                        {q === "standard" ? "Standard" : "Économie"}
                      </span>
                      <span className="tabular text-sand text-xl">
                        {formatUsd(option.totalUsd)}
                      </span>
                    </label>
                  );
                }),
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {tier === "eco"
                ? "Éco : moitié prix, prêt en quelques heures (jusqu'à 24 h)."
                : "Express : prêt en quelques minutes, plein tarif."}{" "}
              {quality === "economy"
                ? "Économie : voix un peu moins fine, un tiers moins chère."
                : ""}
            </p>
          </fieldset>

          <div className="bg-card space-y-3 rounded-2xl p-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Budget restant ce mois-ci</span>
              <span className="tabular">{formatUsd(Math.max(0, budgetUsd - spentUsd))}</span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full",
                  overBudget ? "bg-destructive" : needsConfirmation ? "bg-sand" : "bg-lavender",
                )}
                style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
              />
            </div>
            <p className="text-muted-foreground text-sm">
              Après ce cours : {Math.round(ratio * 100)} % du budget de {formatUsd(budgetUsd)}.
              C&apos;est une estimation.
            </p>
          </div>

          {overBudget ? (
            <ErrorNote message="Ce cours dépasse le budget du mois. Choisis une option moins chère, ou augmente le budget dans les réglages." />
          ) : needsConfirmation ? (
            <label className="bg-card flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl p-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="accent-sand mt-1 size-5"
              />
              <span>
                Ce cours fait passer le mois au-delà de 80 % du budget. Je confirme vouloir le
                générer.
              </span>
            </label>
          ) : null}

          {error ? <ErrorNote message={error} /> : null}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setStep(1)}
              aria-label="Revenir aux réglages"
            >
              <ArrowLeft aria-hidden />
            </Button>
            <Button
              type="button"
              size="lg"
              className="flex-1"
              disabled={launching || overBudget || (needsConfirmation && !confirmed)}
              onClick={() => void launch()}
            >
              {launching ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Générer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function SourceStep({
  limits,
  onPrepared,
}: {
  limits: WizardProps["limits"];
  onPrepared: (source: PreparedSource) => void;
}) {
  const [tab, setTab] = useState<SourceTab>("pdf");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | { label: string; ratio: number | null }>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function sendFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (files.length === 0 || tab === "text") return;
    setError(null);
    if (tab === "images" && files.length > limits.maxImages) {
      return setError(`${limits.maxImages} photos maximum par cours.`);
    }
    // Les photos sont lues dans l'ordre de leur nom : c'est l'ordre des pages.
    files.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
    try {
      setBusy({ label: "Envoi", ratio: 0 });
      const uploaded = await uploadFiles(tab, files, ({ loaded, total }) =>
        setBusy({ label: "Envoi", ratio: total > 0 ? loaded / total : 0 }),
      );
      setBusy({ label: "Lecture du document", ratio: null });
      const result = await prepareSource({
        kind: tab,
        courseId: uploaded.courseId,
        keys: uploaded.keys,
        fileName: files[0]?.name,
      });
      if (!result.ok) return setError(result.message);
      onPrepared(result.data);
    } catch (cause) {
      setError(
        cause instanceof UploadError
          ? cause.message
          : "L'envoi a échoué. Vérifie ta connexion et réessaie.",
      );
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function sendText() {
    setError(null);
    setBusy({ label: "Lecture du texte", ratio: null });
    const result = await prepareSource({ kind: "text", text });
    setBusy(null);
    if (!result.ok) return setError(result.message);
    onPrepared(result.data);
  }

  const accept =
    tab === "pdf"
      ? Object.keys(UPLOAD_MIME.pdf).join(",")
      : `${Object.keys(UPLOAD_MIME.images).join(",")},.heic,.heif`;

  return (
    <div className="space-y-6">
      <Choice
        legend="D'où vient ton cours ?"
        name="source"
        value={tab}
        columns={3}
        onChange={(value) => {
          setTab(value);
          setError(null);
        }}
        options={[
          { value: "pdf", label: "PDF" },
          { value: "images", label: "Photos" },
          { value: "text", label: "Texte" },
        ]}
      />

      {tab === "text" ? (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            placeholder="Colle ton cours ici."
            aria-label="Texte du cours"
            className="bg-card placeholder:text-muted-foreground w-full rounded-2xl p-4"
          />
          <p className="text-muted-foreground tabular text-sm">
            {text.length.toLocaleString("fr-FR")} / {limits.maxSourceChars.toLocaleString("fr-FR")}{" "}
            caractères
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={
              busy !== null || text.trim().length < 200 || text.length > limits.maxSourceChars
            }
            onClick={() => void sendText()}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <TextCursorInput aria-hidden />
            )}
            Continuer
          </Button>
        </div>
      ) : (
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void sendFiles(event.dataTransfer.files);
          }}
          className={cn(
            "border-input bg-card/60 hover:bg-card flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-6 text-center transition-colors",
            busy && "pointer-events-none",
          )}
        >
          <input
            ref={input}
            type="file"
            accept={accept}
            multiple={tab === "images"}
            className="sr-only"
            disabled={busy !== null}
            onChange={(event) => void sendFiles(event.target.files)}
          />
          {busy ? (
            <div className="w-full max-w-60 space-y-3" role="status">
              <p>{busy.label}…</p>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "bg-sand h-full rounded-full transition-[width]",
                    busy.ratio === null && "w-full animate-pulse",
                  )}
                  style={
                    busy.ratio === null ? undefined : { width: `${Math.round(busy.ratio * 100)}%` }
                  }
                />
              </div>
              {busy.ratio !== null ? (
                <p className="text-muted-foreground tabular text-sm">
                  {Math.round(busy.ratio * 100)} %
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {tab === "pdf" ? (
                <FileText className="text-lavender size-10" strokeWidth={1.4} aria-hidden />
              ) : (
                <Images className="text-lavender size-10" strokeWidth={1.4} aria-hidden />
              )}
              <span className="text-lg">
                {tab === "pdf" ? "Choisir un PDF" : "Choisir les photos de tes notes"}
              </span>
              <span className="text-muted-foreground text-sm">
                {tab === "pdf"
                  ? `${limits.maxPdfPages} pages et ${limits.maxUploadMb} Mo au plus.`
                  : `Jusqu'à ${limits.maxImages} photos, dans l'ordre de leur nom. JPG, PNG, WEBP ou HEIC.`}
              </span>
            </>
          )}
        </label>
      )}
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}
