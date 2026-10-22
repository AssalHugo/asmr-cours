"use client";

import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createBinderSample,
  deleteBinder,
  dequeueLesson,
  enqueueLesson,
  pauseBinder,
  resumeBinder,
  startBinder,
} from "@/app/(app)/binders/actions";
import {
  ComboPicker,
  CourseSettingsFields,
  initialListening,
  type ListeningSettings,
  type VoiceOption,
} from "@/components/course/course-settings-fields";
import type { WizardProps } from "@/components/course/new-course-wizard";
import { ErrorNote } from "@/components/error-note";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { rangeChars, samplePages, type LessonDraft, type LessonLimits } from "@/lib/binder/detect";
import {
  mergeWithNext,
  partitionError,
  planLessons,
  splitLesson,
  type PlannedLesson,
} from "@/lib/binder/lessons";
import { BUDGET_WARNING_RATIO, expressAllowed } from "@/lib/budget";
import { CourseSettings, type ActionResult } from "@/lib/course-input";
import type { Binder, BinderLesson, CourseProgress } from "@/lib/data";
import {
  comboKey,
  estimateCourse,
  type ComboKey,
  type CourseEstimate,
  type EstimateModels,
  type TtsQuality,
  type TtsTier,
} from "@/lib/estimate";
import { formatDuration, formatUsd } from "@/lib/format";
import { SAMPLE_MAX_CHARS } from "@/lib/pipeline/sections";
import { isActive, STATUS_LABEL } from "@/lib/pipeline/status";
import { cn } from "@/lib/utils";

type Props = {
  binder: Binder;
  lessons: BinderLesson[];
  courses: CourseProgress[];
  voices: VoiceOption[];
  defaults: WizardProps["defaults"];
  budget: { spentUsd: number; budgetUsd: number };
  models: EstimateModels;
  mock: boolean;
  measured: WizardProps["measured"];
  limits: LessonLimits;
};

/** Le classeur se relit tant qu'un de ses cours se prépare. */
const REFRESH_MS = 4000;
const COMBOS = ["eco-standard", "eco-economy", "express-standard", "express-economy"] as const;
/** Pages lues pour l'échantillon, comme côté serveur. */
const SAMPLE_SOURCE = { targetChars: 6000, maxPages: 4 };

export function BinderView(props: Props) {
  const router = useRouter();
  const watching =
    props.binder.status === "running" || props.courses.some((c) => isActive(c.status));
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [watching, router]);

  return (
    <div className="space-y-10">
      {props.binder.status === "draft" ? <DraftView {...props} /> : <QueueView {...props} />}
      <DeleteBinder binder={props.binder} />
    </div>
  );
}

/** Réglages enregistrés au lancement, ou ceux du profil. */
function initialSettings(props: Props): {
  listening: ListeningSettings;
  tier: TtsTier;
  quality: TtsQuality;
} {
  const saved = CourseSettings.safeParse(props.binder.settings);
  if (saved.success && props.voices.some((v) => v.id === saved.data.voiceId)) {
    const { tier, quality, ...listening } = saved.data;
    return { listening, tier, quality };
  }
  return {
    listening: initialListening(props),
    tier: props.defaults.tier,
    quality: props.defaults.quality,
  };
}

function useEstimator(props: Props, listening: ListeningSettings) {
  return useMemo(() => {
    const measured = props.measured.filter(
      (m) => m.voiceId === listening.voiceId && m.mode === listening.mode,
    );
    const at = new Date();
    return (lesson: { chars: number; pages: number }): CourseEstimate =>
      estimateCourse({
        sourceChars: lesson.chars,
        sourceKind: "pdf",
        pages: lesson.pages,
        mode: listening.mode,
        quiz: listening.quiz,
        measured,
        models: props.models,
        at,
        mock: props.mock,
      });
  }, [props.measured, props.models, props.mock, listening]);
}

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(action: () => Promise<ActionResult<T>>, done?: (data: T) => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) return setError(result.message);
      done?.(result.data as T);
      router.refresh();
    });
  return { pending, error, run };
}

function DraftView(props: Props) {
  const { binder } = props;
  const shape = { pages: binder.pages, pageChars: binder.page_chars, scanned: binder.scanned };
  const [drafts, setDrafts] = useState<LessonDraft[]>(() =>
    props.lessons.map((l) => ({ title: l.title, firstPage: l.first_page, selected: l.selected })),
  );
  const initial = initialSettings(props);
  const [listening, setListening] = useState(initial.listening);
  const [tier, setTier] = useState(initial.tier);
  const [quality, setQuality] = useState(initial.quality);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { pending, error, run } = useAction();

  const planned = useMemo(
    () => planLessons(drafts, shape, props.limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shape` dérive du classeur, fixe.
    [drafts, binder.id, props.limits],
  );
  const broken = partitionError(drafts, binder.pages);
  const estimator = useEstimator(props, listening);
  const estimates = useMemo(() => planned.map((l) => estimator(l)), [planned, estimator]);
  const key = comboKey(tier, quality);

  const chosen = planned.filter((l) => l.selected);
  const blocked = chosen.find((l) => l.problem !== null);
  const totals = useMemo(() => {
    const combos = Object.fromEntries(COMBOS.map((k) => [k, { totalUsd: 0 }])) as Record<
      ComboKey,
      { totalUsd: number }
    >;
    let durationSec = 0;
    planned.forEach((lesson, i) => {
      const estimate = estimates[i];
      if (!lesson.selected || !estimate) return;
      durationSec += estimate.durationSec;
      for (const k of COMBOS) combos[k].totalUsd += estimate.combos[k].totalUsd;
    });
    return { combos, durationSec };
  }, [planned, estimates]);

  // Le serveur contrôle la première leçon comme un cours ; les suivantes, au plafond seulement.
  const { spentUsd, budgetUsd } = props.budget;
  const remaining = Math.max(0, budgetUsd - spentUsd);
  const firstIndex = planned.findIndex((l) => l.selected);
  const firstCost = estimates[firstIndex]?.combos[key].totalUsd ?? 0;
  const firstRatio = budgetUsd > 0 ? (spentUsd + firstCost) / budgetUsd : 0;
  const overBudget = !props.mock && chosen.length > 0 && spentUsd + firstCost > budgetUsd;
  const needsConfirmation = !overBudget && firstRatio > BUDGET_WARNING_RATIO;
  let fitting = 0;
  let cumulated = 0;
  planned.forEach((lesson, i) => {
    if (!lesson.selected) return;
    cumulated += estimates[i]?.combos[key].totalUsd ?? 0;
    if (cumulated <= remaining || props.mock) fitting++;
  });

  const [sampleIndex, setSampleIndex] = useState(() =>
    Math.max(
      0,
      planned.findIndex((l) => l.selected && l.range),
    ),
  );
  const sampleLesson = planned[sampleIndex];
  const sampleCost = useMemo(() => {
    if (!sampleLesson?.range) return null;
    const range = samplePages(sampleLesson.range, binder.page_chars, binder.scanned, SAMPLE_SOURCE);
    const chars = Math.min(
      SAMPLE_MAX_CHARS,
      rangeChars(range.firstPage, range.lastPage, binder.page_chars),
    );
    const estimate = estimator({ chars, pages: range.lastPage - range.firstPage + 1 });
    return {
      usd: estimate.combos[comboKey("express", quality)].totalUsd,
      sec: estimate.durationSec,
    };
  }, [sampleLesson, binder.page_chars, binder.scanned, estimator, quality]);
  const sample = props.courses.find((c) => c.id === binder.sample_course_id) ?? null;
  const sampleBusy = sample !== null && isActive(sample.status);

  const update = (index: number, patch: Partial<LessonDraft>) =>
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const settings = { ...listening, tier, quality };

  return (
    <>
      <section className="space-y-4" aria-labelledby="lessons-title">
        <div className="flex items-end justify-between gap-3">
          <h2 id="lessons-title" className="text-xl">
            1. Les leçons
          </h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDrafts((d) => d.map((l, i) => ({ ...l, selected: planned[i]?.range != null })))
              }
            >
              Tout cocher
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrafts((d) => d.map((l) => ({ ...l, selected: false })))}
            >
              Aucune
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Coche celles à écouter. Une leçon court jusqu&apos;à la page qui précède la suivante :
          ajuste les pages ou coupe une leçon trop longue avec le crayon.
        </p>
        {broken ? <ErrorNote message={broken} /> : null}
        <ol className="space-y-2">
          {planned.map((lesson, index) => (
            <DraftLessonRow
              key={index}
              lesson={lesson}
              estimate={estimates[index]}
              comboKey={key}
              editing={editing === index}
              isFirst={index === 0}
              isLast={index === planned.length - 1}
              maxPage={binder.pages}
              onToggleEdit={() => setEditing(editing === index ? null : index)}
              onChange={(patch) => update(index, patch)}
              onSplit={() => setDrafts((d) => splitLesson(d, index, binder.pages))}
              onMerge={() => {
                setDrafts((d) => mergeWithNext(d, index));
                setEditing(null);
              }}
            />
          ))}
        </ol>
      </section>

      <section className="space-y-8" aria-labelledby="settings-title">
        <h2 id="settings-title" className="text-xl">
          2. Les réglages
        </h2>
        <CourseSettingsFields voices={props.voices} value={listening} onChange={setListening} />
        <ComboPicker
          legend={`Vitesse et qualité, pour ${chosen.length} leçon${chosen.length > 1 ? "s" : ""}`}
          combos={totals.combos}
          tier={tier}
          quality={quality}
          blocked={(t, q) =>
            t === "express" &&
            !props.mock &&
            !expressAllowed(
              spentUsd,
              estimates[firstIndex]?.combos[comboKey(t, q)].totalUsd ?? 0,
              budgetUsd,
            )
          }
          onChange={(t, q) => {
            setTier(t);
            setQuality(q);
            setConfirmed(false);
          }}
          ecoHint="Éco : moitié prix, mais chaque leçon peut attendre plusieurs heures : la file avance lentement."
        />
      </section>

      <section className="space-y-4" aria-labelledby="sample-title">
        <h2 id="sample-title" className="text-xl">
          3. L&apos;échantillon
        </h2>
        <p className="text-muted-foreground text-sm">
          Quelques minutes du début d&apos;une leçon, avec ces réglages, prêtes en quelques minutes.
          Si la voix ou l&apos;ambiance ne te plaît pas, change-les et refais-le : seul
          l&apos;échantillon est payé.
        </p>
        <label className="block space-y-2">
          <span className="text-muted-foreground text-sm">Tiré de la leçon</span>
          <select
            value={sampleIndex}
            onChange={(event) => setSampleIndex(Number(event.target.value))}
            className="bg-card h-12 w-full rounded-2xl px-4"
          >
            {planned.map((lesson, index) =>
              lesson.range ? (
                <option key={index} value={index}>
                  {lesson.title}
                </option>
              ) : null,
            )}
          </select>
        </label>
        {sample ? <SampleStatus sample={sample} /> : null}
        <Button
          type="button"
          variant={sample?.status === "ready" ? "secondary" : "default"}
          className="w-full"
          disabled={pending || sampleBusy || !sampleLesson?.range || broken !== null}
          onClick={() =>
            run(
              () =>
                createBinderSample({
                  binderId: binder.id,
                  lessons: drafts,
                  lessonIndex: sampleIndex,
                  settings,
                }),
              () => toast.success("Échantillon lancé."),
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {sample ? "Refaire l'échantillon avec ces réglages" : "Écouter un échantillon"}
          {sampleCost ? (
            <span className="tabular opacity-75">
              · ≈ {formatDuration(sampleCost.sec * 1000)}, {formatUsd(sampleCost.usd)}
            </span>
          ) : null}
        </Button>
      </section>

      <section className="space-y-4" aria-labelledby="launch-title">
        <h2 id="launch-title" className="text-xl">
          4. La file
        </h2>
        <div className="bg-card space-y-3 rounded-2xl p-4">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {chosen.length} leçon{chosen.length > 1 ? "s" : ""}, ≈{" "}
              {formatDuration(totals.durationSec * 1000)}
            </span>
            <span className="tabular text-sand">{formatUsd(totals.combos[key].totalUsd)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Budget restant ce mois-ci</span>
            <span className="tabular">{formatUsd(remaining)}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Les leçons partent une à une, chacune après un contrôle du budget.{" "}
            {fitting < chosen.length
              ? `Le budget du mois couvre environ ${fitting} leçon${fitting > 1 ? "s" : ""} : la file se mettra en pause ensuite, et tu la relanceras le mois prochain (ou après avoir augmenté le budget).`
              : "Le budget du mois couvre toute la file."}
          </p>
        </div>
        {overBudget ? (
          <ErrorNote message="La première leçon dépasse déjà le budget du mois. Choisis une option moins chère, ou augmente le budget dans les réglages." />
        ) : needsConfirmation ? (
          <label className="bg-card flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl p-4">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="accent-sand mt-1 size-5"
            />
            <span>
              La première leçon fait passer le mois au-delà de 80 % du budget. Je confirme vouloir
              lancer la file.
            </span>
          </label>
        ) : null}
        {blocked ? <ErrorNote message={`« ${blocked.title} » : ${blocked.problem}`} /> : null}
        {error ? <ErrorNote message={error} /> : null}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={
            pending ||
            chosen.length === 0 ||
            broken !== null ||
            blocked !== undefined ||
            overBudget ||
            (needsConfirmation && !confirmed)
          }
          onClick={() =>
            run(
              () => startBinder({ binderId: binder.id, lessons: drafts, settings, confirmed }),
              (data) => toast.success(data.notice ?? "C'est lancé : la première leçon se prépare."),
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Lancer {chosen.length > 1 ? `les ${chosen.length} leçons` : "la leçon"}
        </Button>
        {sample?.status !== "ready" ? (
          <p className="text-muted-foreground text-center text-sm">
            Conseillé : écoute d&apos;abord l&apos;échantillon.
          </p>
        ) : null}
      </section>
    </>
  );
}

function DraftLessonRow({
  lesson,
  estimate,
  comboKey: key,
  editing,
  isFirst,
  isLast,
  maxPage,
  onToggleEdit,
  onChange,
  onSplit,
  onMerge,
}: {
  lesson: PlannedLesson;
  estimate: CourseEstimate | undefined;
  comboKey: ComboKey;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  maxPage: number;
  onToggleEdit: () => void;
  onChange: (patch: Partial<LessonDraft>) => void;
  onSplit: () => void;
  onMerge: () => void;
}) {
  return (
    <li
      className={cn(
        "bg-card rounded-2xl p-3 ring-1 ring-transparent",
        lesson.selected && "ring-sand/50",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={lesson.selected}
          onChange={(event) => onChange({ selected: event.target.checked })}
          aria-label={`Générer « ${lesson.title} »`}
          className="accent-sand mt-1 size-5 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("leading-snug", !lesson.selected && "text-muted-foreground")}>
            {lesson.title}
          </p>
          <p className="text-muted-foreground tabular text-sm">
            p. {lesson.firstPage}–{lesson.lastPage}
            {lesson.range && estimate
              ? ` · ≈ ${formatDuration(estimate.durationSec * 1000)} · ${formatUsd(estimate.combos[key].totalUsd)}`
              : ""}
          </p>
          {lesson.problem && lesson.selected ? (
            <p className="text-destructive text-sm">{lesson.problem}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleEdit}
          aria-expanded={editing}
          aria-label={`Modifier « ${lesson.title} »`}
        >
          <Pencil aria-hidden />
        </Button>
      </div>
      {editing ? (
        <div className="border-border mt-3 space-y-3 border-t pt-3">
          <label className="block space-y-1">
            <span className="text-muted-foreground text-sm">Titre</span>
            <input
              value={lesson.title}
              maxLength={200}
              onChange={(event) => onChange({ title: event.target.value })}
              className="bg-background h-11 w-full rounded-xl px-3"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground text-sm">Commence à la page</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxPage}
              value={lesson.firstPage}
              disabled={isFirst}
              onChange={(event) => {
                const page = Number(event.target.value);
                if (Number.isInteger(page) && page >= 1) onChange({ firstPage: page });
              }}
              className="bg-background tabular h-11 w-28 rounded-xl px-3 disabled:opacity-50"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={lesson.lastPage <= lesson.firstPage}
              onClick={onSplit}
            >
              Couper en deux
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={isLast} onClick={onMerge}>
              Réunir avec la suivante
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function SampleStatus({ sample }: { sample: CourseProgress }) {
  if (isActive(sample.status)) {
    return (
      <div className="bg-card space-y-2 rounded-2xl p-4" role="status">
        <p className="flex items-center gap-2">
          <Loader2 className="text-lavender size-4 animate-spin" aria-hidden />
          Échantillon : {STATUS_LABEL[sample.status].toLowerCase()}…
        </p>
        <Progress value={sample.progress} aria-label="Avancement de l'échantillon" />
      </div>
    );
  }
  if (sample.status === "failed") {
    return (
      <ErrorNote message={`L'échantillon s'est arrêté : ${sample.error ?? "erreur inconnue"}`} />
    );
  }
  return (
    <div className="bg-card space-y-3 rounded-2xl p-4">
      <p className="flex items-center gap-2">
        <CircleCheck className="text-sand size-4" aria-hidden />
        Échantillon prêt
        {sample.duration_ms ? ` · ${formatDuration(sample.duration_ms)}` : ""}
      </p>
      {/* Pré-mix voix + ambiance : ce qu'elle entendra dans le lecteur. */}
      <audio
        controls
        preload="none"
        src={`/api/audio/${sample.id}/mix-${sample.ambience}.m4a`}
        className="w-full"
      />
      <Link
        href={`/play/${sample.id}`}
        className="text-sand inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4"
      >
        <Play className="size-4" aria-hidden />
        Ouvrir dans le lecteur
      </Link>
    </div>
  );
}

function QueueView(props: Props) {
  const { binder } = props;
  const courseById = new Map(props.courses.map((c) => [c.id, c]));
  const initial = initialSettings(props);
  const [listening, setListening] = useState(initial.listening);
  const [tier, setTier] = useState(initial.tier);
  const [quality, setQuality] = useState(initial.quality);
  const [changing, setChanging] = useState(false);
  const { pending, error, run } = useAction();
  const estimator = useEstimator(props, listening);

  const shape = { pages: binder.pages, pageChars: binder.page_chars, scanned: binder.scanned };
  const planned = planLessons(
    props.lessons.map((l) => ({ title: l.title, firstPage: l.first_page, selected: l.selected })),
    shape,
    props.limits,
  );
  const ready = props.lessons.filter(
    (l) => l.course_id && courseById.get(l.course_id)?.status === "ready",
  ).length;
  const inQueue = props.lessons.filter((l) => l.state !== "idle").length;
  const waiting = planned.filter((_, i) => props.lessons[i]?.state === "queued");
  const waitingCombos = Object.fromEntries(
    COMBOS.map((k) => [
      k,
      { totalUsd: waiting.reduce((sum, l) => sum + estimator(l).combos[k].totalUsd, 0) },
    ]),
  ) as Record<ComboKey, { totalUsd: number }>;

  return (
    <>
      <section className="space-y-4">
        <div className="bg-card space-y-3 rounded-2xl p-4">
          <p className="flex items-center gap-2">
            {binder.status === "running" ? (
              <Loader2 className="text-lavender size-4 animate-spin" aria-hidden />
            ) : binder.status === "paused" ? (
              <CirclePause className="text-sand size-4" aria-hidden />
            ) : (
              <CircleCheck className="text-sand size-4" aria-hidden />
            )}
            {binder.status === "running"
              ? "La file avance, une leçon à la fois."
              : binder.status === "paused"
                ? "La file est en pause."
                : "Toutes les leçons de la file sont passées."}
          </p>
          <Progress value={inQueue > 0 ? (ready / inQueue) * 100 : 0} aria-label="Leçons prêtes" />
          <p className="text-muted-foreground tabular text-sm">
            {ready} leçon{ready > 1 ? "s" : ""} prête{ready > 1 ? "s" : ""} sur {inQueue}. Elles
            sont rangées dans le dossier « {binder.title.slice(0, 60)} » de la bibliothèque.
          </p>
          {binder.error ? (
            <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {binder.error}
            </p>
          ) : null}
          {binder.status === "running" ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => run(() => pauseBinder(binder.id))}
            >
              <Pause aria-hidden />
              Mettre en pause
            </Button>
          ) : binder.status === "paused" ? (
            <div className="space-y-3">
              <Button
                type="button"
                className="w-full"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      resumeBinder(
                        binder.id,
                        changing ? { ...listening, tier, quality } : undefined,
                      ),
                    (data) => {
                      setChanging(false);
                      toast.success(data.notice ?? "La file repart.");
                    },
                  )
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                Reprendre la file{changing ? " avec ces réglages" : ""}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                aria-expanded={changing}
                onClick={() => setChanging(!changing)}
              >
                {changing ? "Garder les réglages" : "Changer les réglages des leçons suivantes"}
              </Button>
            </div>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
        </div>
        {changing && binder.status === "paused" ? (
          <div className="space-y-8">
            <CourseSettingsFields voices={props.voices} value={listening} onChange={setListening} />
            <ComboPicker
              legend={`Vitesse et qualité, pour les ${waiting.length} leçons en attente`}
              combos={waitingCombos}
              tier={tier}
              quality={quality}
              blocked={() => false}
              onChange={(t, q) => {
                setTier(t);
                setQuality(q);
              }}
            />
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="queue-title">
        <h2 id="queue-title" className="text-xl">
          Les leçons
        </h2>
        <ol className="space-y-2">
          {props.lessons.map((lesson, index) => (
            <QueueLessonRow
              key={lesson.id}
              lesson={lesson}
              planned={planned[index]}
              course={lesson.course_id ? (courseById.get(lesson.course_id) ?? null) : null}
              pending={pending}
              onDequeue={() => run(() => dequeueLesson(binder.id, lesson.id))}
              onEnqueue={() =>
                run(
                  () => enqueueLesson(binder.id, lesson.id),
                  (data) => toast.success(data.notice ?? "Ajoutée à la file."),
                )
              }
            />
          ))}
        </ol>
      </section>
    </>
  );
}

function QueueLessonRow({
  lesson,
  planned,
  course,
  pending,
  onDequeue,
  onEnqueue,
}: {
  lesson: BinderLesson;
  planned: PlannedLesson | undefined;
  course: CourseProgress | null;
  pending: boolean;
  onDequeue: () => void;
  onEnqueue: () => void;
}) {
  const pages = `p. ${lesson.first_page}–${lesson.last_page}`;
  let status: React.ReactNode;
  let action: React.ReactNode = null;
  if (lesson.state === "launched") {
    if (!course) {
      status = "Cours supprimé";
    } else if (course.status === "ready") {
      status = (
        <span className="text-sand">
          Prête{course.duration_ms ? ` · ${formatDuration(course.duration_ms)}` : ""}
        </span>
      );
      action = (
        <Button asChild variant="ghost" size="icon">
          <Link href={`/play/${course.id}`} aria-label={`Écouter « ${lesson.title} »`}>
            <Play aria-hidden />
          </Link>
        </Button>
      );
    } else if (course.status === "failed") {
      status = <span className="text-destructive">Arrêtée : {course.error ?? "erreur"}</span>;
    } else {
      status = `${STATUS_LABEL[course.status]} · ${course.progress} %`;
    }
  } else if (lesson.state === "queued") {
    status = "En attente";
    action = (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={onDequeue}
        aria-label={`Retirer « ${lesson.title} » de la file`}
      >
        <X aria-hidden />
      </Button>
    );
  } else {
    status = planned?.problem ?? "Pas dans la file";
    action = planned?.problem ? null : (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={onEnqueue}
        aria-label={`Ajouter « ${lesson.title} » à la file`}
      >
        <Plus aria-hidden />
      </Button>
    );
  }
  const Icon =
    lesson.state === "idle"
      ? CircleDashed
      : course?.status === "ready"
        ? CircleCheck
        : course && isActive(course.status)
          ? Loader2
          : CircleDashed;

  return (
    <li className="bg-card flex items-center gap-3 rounded-2xl p-3">
      <Icon
        className={cn(
          "size-5 shrink-0",
          lesson.state === "idle" ? "text-muted-foreground" : "text-lavender",
          Icon === Loader2 && "animate-spin",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        {course ? (
          <Link href={`/courses/${course.id}`} className="block leading-snug hover:underline">
            {lesson.title}
          </Link>
        ) : (
          <p className={cn("leading-snug", lesson.state === "idle" && "text-muted-foreground")}>
            {lesson.title}
          </p>
        )}
        <p className="text-muted-foreground tabular text-sm">
          {pages} · {status}
        </p>
      </div>
      {action}
    </li>
  );
}

function DeleteBinder({ binder }: { binder: Binder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive" disabled={pending}>
          <Trash2 aria-hidden />
          Supprimer le classeur
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {binder.title} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            Le PDF, l&apos;échantillon et les leçons pas encore lancées disparaissent. Les leçons
            déjà générées restent dans ta bibliothèque.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Garder</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await deleteBinder(binder.id);
                if (!result.ok) return void toast.error(result.message);
                toast.success("Classeur supprimé.");
                router.push("/library");
              })
            }
          >
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
