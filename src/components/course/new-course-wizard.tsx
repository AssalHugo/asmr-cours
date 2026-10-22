"use client";

import {
  ArrowLeft,
  Cloud,
  FileText,
  Images,
  Library,
  Loader2,
  TextCursorInput,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createCourse, prepareSource, type PreparedSource } from "@/app/(app)/actions";
import { createBinder } from "@/app/(app)/binders/actions";
import { Choice } from "@/components/choice";
import {
  ComboPicker,
  CourseSettingsFields,
  initialListening,
} from "@/components/course/course-settings-fields";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { pickFromDrive, preloadDrive } from "@/components/upload/drive-picker";
import { uploadFiles, UploadError } from "@/components/upload/upload-files";

import { BUDGET_WARNING_RATIO, expressAllowed } from "@/lib/budget";
import type { DriveConfig } from "@/lib/drive";
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
  limits: {
    maxUploadMb: number;
    maxPdfPages: number;
    maxSourceChars: number;
    maxImages: number;
    /** Un PDF plus lourd, ou trop long pour un cours, devient un classeur découpé en leçons. */
    maxBinderMb: number;
  };
  /** Réglages du sélecteur Google Drive ; `null` masque le bouton. */
  drive: DriveConfig | null;
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
  const [listening, setListening] = useState(() => initialListening(props));
  const { mode, voiceId, quiz } = listening;
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
      quiz,
      measured: props.measured.filter((m) => m.voiceId === voiceId && m.mode === mode),
      models: props.models,
      at: new Date(),
      mock: props.mock,
    });
  }, [prepared, mode, quiz, voiceId, props.measured, props.models, props.mock]);

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
      ...listening,
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

      {step === 0 ? (
        <SourceStep
          limits={props.limits}
          drive={props.drive}
          previous={prepared}
          onPrepared={onPrepared}
        />
      ) : null}

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

          <CourseSettingsFields voices={props.voices} value={listening} onChange={setListening} />

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

          <ComboPicker
            combos={estimate.combos}
            tier={tier}
            quality={quality}
            blocked={(t, q) =>
              t === "express" &&
              !expressAllowed(spentUsd, estimate.combos[comboKey(t, q)].totalUsd, budgetUsd) &&
              !props.mock
            }
            onChange={(t, q) => {
              setTier(t);
              setQuality(q);
              setConfirmed(false);
            }}
          />

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

function SourceStep({
  limits,
  drive,
  previous,
  onPrepared,
}: {
  limits: WizardProps["limits"];
  drive: WizardProps["drive"];
  /** Dépôt précédent, quand on revient changer de source : il est remplacé, pas accumulé. */
  previous: PreparedSource | null;
  onPrepared: (source: PreparedSource) => void;
}) {
  const [tab, setTab] = useState<SourceTab>("pdf");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | { label: string; ratio: number | null }>(null);
  const [error, setError] = useState<string | null>(null);
  /** PDF déposé mais trop long pour un seul cours : il peut devenir un classeur. */
  const [tooLong, setTooLong] = useState<{ binderId: string; key: string; name: string } | null>(
    null,
  );
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Annule un téléchargement Drive en cours lors du démontage du composant.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Scripts Google chargés d'avance : au clic, la fenêtre de connexion s'ouvre sans délai.
  useEffect(() => {
    if (drive) preloadDrive().catch(() => undefined);
  }, [drive]);

  async function sendFromDrive() {
    if (!drive || tab === "text") return;
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setBusy({ label: "Google Drive", ratio: null });
      const files = await pickFromDrive(
        drive,
        tab,
        {
          maxFiles: tab === "images" ? limits.maxImages : 1,
          maxBytes: (tab === "pdf" ? limits.maxBinderMb : limits.maxUploadMb) * 1024 * 1024,
        },
        (ratio) => setBusy({ label: "Récupération depuis Drive", ratio }),
        controller.signal,
      );
      if (files) return await sendFiles(files);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof UploadError
          ? cause.message
          : "La récupération depuis Google Drive a échoué. Réessaie.",
      );
    }
    if (!controller.signal.aborted) setBusy(null);
  }

  /** Classeur : le PDF est analysé (sommaire, signets), puis ses leçons proposées. */
  async function openBinder(binderId: string, key: string, name: string) {
    setBusy({ label: "Recherche des leçons", ratio: null });
    const result = await createBinder({ binderId, key, fileName: name });
    if (!result.ok) {
      setBusy(null);
      return setError(result.message);
    }
    router.push(`/binders/${result.data.binderId}`);
  }

  async function sendFiles(files: File[]) {
    if (files.length === 0 || tab === "text") return;
    setError(null);
    setTooLong(null);
    const [pdf] = files;
    if (tab === "pdf" && pdf && pdf.size > limits.maxUploadMb * 1024 * 1024) {
      return sendBinder(pdf);
    }
    if (tab === "images" && files.length > limits.maxImages) {
      return setError(`${limits.maxImages} photos maximum par cours.`);
    }
    // Les photos sont lues dans l'ordre de leur nom : c'est l'ordre des pages.
    files.sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
    try {
      setBusy({ label: "Envoi", ratio: 0 });
      const uploaded = await uploadFiles(
        tab,
        files,
        ({ loaded, total }) => setBusy({ label: "Envoi", ratio: total > 0 ? loaded / total : 0 }),
        undefined,
        previous?.courseId,
      );
      setBusy({ label: "Lecture du document", ratio: null });
      const result = await prepareSource({
        kind: tab,
        courseId: uploaded.courseId,
        keys: uploaded.keys,
        fileName: files[0]?.name,
      });
      if (!result.ok) {
        const [key] = uploaded.keys;
        if (result.reason === "too_long" && key && files[0]) {
          setTooLong({ binderId: uploaded.courseId, key, name: files[0].name });
        }
        return setError(result.message);
      }
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

  async function sendBinder(file: File) {
    try {
      setBusy({ label: "Envoi", ratio: 0 });
      const uploaded = await uploadFiles("binder", [file], ({ loaded, total }) =>
        setBusy({ label: "Envoi", ratio: total > 0 ? loaded / total : 0 }),
      );
      const [key] = uploaded.keys;
      if (!key) throw new UploadError("Réponse d'upload incomplète.");
      await openBinder(uploaded.courseId, key, file.name);
    } catch (cause) {
      setBusy(null);
      setError(
        cause instanceof UploadError
          ? cause.message
          : "L'envoi a échoué. Vérifie ta connexion et réessaie.",
      );
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function sendText() {
    setError(null);
    setBusy({ label: "Lecture du texte", ratio: null });
    const result = await prepareSource({
      kind: "text",
      text,
      courseId: previous?.kind === "text" ? previous.courseId : undefined,
    });
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
          abortRef.current?.abort();
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
            void sendFiles([...event.dataTransfer.files]);
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
            onChange={(event) => void sendFiles([...(event.target.files ?? [])])}
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
                  ? `Jusqu'à ${limits.maxPdfPages} pages par cours. Plus long, Murmure le découpe en leçons.`
                  : `Jusqu'à ${limits.maxImages} photos, dans l'ordre de leur nom. JPG, PNG, WEBP ou HEIC.`}
              </span>
            </>
          )}
        </label>
      )}
      {drive && tab !== "text" ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void sendFromDrive()}
          >
            <Cloud aria-hidden />
            Choisir dans Google Drive
          </Button>
          {tab === "pdf" ? (
            <p className="text-muted-foreground text-center text-sm">
              Les Google Docs et Slides sont convertis en PDF.
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {tooLong && !busy ? (
        <div className="bg-card space-y-3 rounded-2xl p-4">
          <p className="text-sm">
            Ce document regroupe sans doute plusieurs cours. Murmure peut y retrouver les leçons
            (sommaire, titres) : tu choisis lesquelles écouter, sans rien découper toi-même.
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => void openBinder(tooLong.binderId, tooLong.key, tooLong.name)}
          >
            <Library aria-hidden />
            Le découper en leçons
          </Button>
        </div>
      ) : null}
    </div>
  );
}
