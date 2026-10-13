"use client";

import { BellRing, Check, Loader2, Play, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCourse, regenerateSection, remixCourse, resumeCourse } from "@/app/(app)/actions";
import { BreathOrb } from "@/components/breath-orb";
import { Choice } from "@/components/choice";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useCourseRun } from "@/hooks/use-course-run";
import { AMBIENCE_GAIN_RANGE, AMBIENCES, getAmbience } from "@/lib/ambiences";
import type { ActionResult } from "@/lib/course-input";
import { formatClock, formatDuration, formatUsd } from "@/lib/format";
import { removeCourse } from "@/lib/offline";
import { isActive, STATUS_LABEL, type CourseStatus } from "@/lib/pipeline/status";
import { OfflineToggle } from "./offline-toggle";

export type SectionView = {
  id: string;
  title: string;
  durationMs: number | null;
  verified: boolean;
  checked: boolean;
  report: { missingFacts: string[]; alteredFacts: string[]; inventedClaims: string[] } | null;
};

export type CourseViewProps = {
  course: {
    id: string;
    title: string;
    status: CourseStatus;
    progress: number;
    error: string | null;
    tier: "eco" | "express";
    ambience: string;
    ambienceGainDb: number;
    durationMs: number | null;
    estUsd: number | null;
    actualUsd: number;
  };
  sections: SectionView[];
};

export function CourseView({ course, sections }: CourseViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = useCourseRun(course.id, {
    status: course.status,
    progress: course.progress,
    costUsd: course.actualUsd,
    durationMs: 0,
    error: course.error ?? undefined,
  });

  // Fin de génération : toast, notification locale si elle est autorisée, puis rechargement.
  const seen = useRef(run.status);
  useEffect(() => {
    if (seen.current === run.status) return;
    const was = seen.current;
    seen.current = run.status;
    if (run.status === "ready" && isActive(was)) {
      toast.success(`« ${course.title} » est prêt à écouter.`);
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.hidden
      ) {
        new Notification("Murmure", { body: `« ${course.title} » est prêt à écouter.` });
      }
      router.refresh();
    } else if (run.status === "failed") {
      router.refresh();
    }
  }, [run.status, course.title, router]);

  function act(
    action: () => Promise<ActionResult<{ courseId: string }> | ActionResult>,
    done?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      done?.();
      router.refresh();
    });
  }

  const active = isActive(run.status);

  return (
    <div className="space-y-10">
      {active ? (
        <section className="flex flex-col items-center gap-6 py-6 text-center" aria-live="polite">
          <BreathOrb size="lg">
            <span className="font-heading tabular text-3xl">{run.progress} %</span>
          </BreathOrb>
          <div className="space-y-1">
            <h2 className="text-2xl">{STATUS_LABEL[run.status]}</h2>
            <p className="text-muted-foreground">
              {run.status === "waiting_batch"
                ? "Le mode Éco prend son temps : jusqu'à 24 h. Tu peux fermer cette page."
                : "Tu peux fermer cette page, Murmure continue."}
            </p>
          </div>
          <dl className="text-muted-foreground tabular flex gap-8 text-sm">
            <div>
              <dt>Coût engagé</dt>
              <dd className="text-foreground text-base">{formatUsd(run.costUsd, 3)}</dd>
            </div>
            {run.durationMs > 0 ? (
              <div>
                <dt>Voix enregistrée</dt>
                <dd className="text-foreground text-base">{formatDuration(run.durationMs)}</dd>
              </div>
            ) : null}
          </dl>
          <NotifyButton />
        </section>
      ) : null}

      {run.status === "failed" ? (
        <section className="bg-card space-y-4 rounded-3xl p-6" role="alert">
          <h2 className="flex items-center gap-2 text-2xl">
            <TriangleAlert className="text-destructive size-6" aria-hidden />
            Génération interrompue
          </h2>
          <p className="text-muted-foreground">
            {run.error ?? course.error ?? "Une erreur est survenue."}
          </p>
          <Button disabled={pending} onClick={() => act(() => resumeCourse(course.id))}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Reprendre
          </Button>
        </section>
      ) : null}

      {run.status === "ready" ? (
        <section className="space-y-6">
          <div className="flex items-center gap-5">
            <Link href={`/play/${course.id}`} aria-label={`Écouter ${course.title}`}>
              <BreathOrb size="md">
                <Play className="ml-1 size-9" fill="currentColor" aria-hidden />
              </BreathOrb>
            </Link>
            <dl className="tabular space-y-1">
              <div className="font-heading text-3xl">
                <dt className="sr-only">Durée</dt>
                <dd>{course.durationMs ? formatDuration(course.durationMs) : "—"}</dd>
              </div>
              <div className="text-muted-foreground text-sm">
                <dt className="sr-only">Coût</dt>
                <dd>
                  {formatUsd(course.actualUsd, 3)} réels
                  {course.estUsd !== null ? ` · ${formatUsd(course.estUsd, 3)} estimés` : ""}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <OfflineToggle courseId={course.id} ambience={course.ambience} />
            <RemixDialog
              course={course}
              pending={pending}
              onSubmit={(input) => act(() => remixCourse(input))}
            />
          </div>
        </section>
      ) : null}

      {sections.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-2xl">Chapitres</h2>
          <ol className="space-y-3">
            {sections.map((section, index) => (
              <li key={section.id} className="bg-card rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-muted-foreground tabular text-sm">
                      Chapitre {index + 1}
                      {section.durationMs ? ` · ${formatClock(section.durationMs)}` : ""}
                    </p>
                    <h3 className="text-lg">{section.title}</h3>
                  </div>
                  {section.checked ? (
                    section.verified ? (
                      <span className="text-lavender flex shrink-0 items-center gap-1 text-sm">
                        <Check className="size-4" aria-hidden />
                        Fidèle
                      </span>
                    ) : (
                      <span className="text-sand flex shrink-0 items-center gap-1 text-sm">
                        <TriangleAlert className="size-4" aria-hidden />À vérifier
                      </span>
                    )
                  ) : null}
                </div>
                {section.checked && !section.verified && section.report ? (
                  <details className="mt-3 text-sm">
                    <summary className="text-sand min-h-11 cursor-pointer content-center">
                      Voir les écarts avec le cours
                    </summary>
                    <ReportList
                      title="Faits absents du script"
                      items={section.report.missingFacts}
                    />
                    <ReportList title="Faits modifiés" items={section.report.alteredFacts} />
                    <ReportList
                      title="Ajouts absents du cours"
                      items={section.report.inventedClaims}
                    />
                  </details>
                ) : null}
                {run.status === "ready" ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-2 -ml-3" disabled={pending}>
                        <RefreshCw aria-hidden />
                        Régénérer cette section
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Régénérer « {section.title} » ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Murmure réécrit et réenregistre ce chapitre, puis réassemble la piste.
                          Seuls les passages qui changent sont facturés.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => act(() => regenerateSection(course.id, section.id))}
                        >
                          Régénérer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="text-destructive -ml-4" disabled={pending}>
            <Trash2 aria-hidden />
            Supprimer ce cours
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {course.title} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              La piste audio et les fichiers déposés sont effacés pour de bon.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                act(
                  () => deleteCourse(course.id),
                  () => {
                    void removeCourse(course.id);
                    toast.success("Cours supprimé.");
                    router.push("/library");
                  },
                )
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Demande, sur un geste, l'autorisation de notifier la fin de la génération. */
function NotifyButton() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  if (permission !== "default") return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void Notification.requestPermission().then(setPermission)}
    >
      <BellRing aria-hidden />
      Me prévenir quand c&apos;est prêt
    </Button>
  );
}

function RemixDialog({
  course,
  pending,
  onSubmit,
}: {
  course: CourseViewProps["course"];
  pending: boolean;
  onSubmit: (input: { courseId: string; ambience: string; ambienceGainDb: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ambience, setAmbience] = useState(course.ambience);
  const [gainDb, setGainDb] = useState(course.ambienceGainDb);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={pending}>
          Changer l&apos;ambiance du pré-mix
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ambiance du pré-mix</DialogTitle>
          <DialogDescription>
            Le pré-mix sert à l&apos;écoute écran verrouillé et hors-ligne. Le refaire ne coûte
            rien.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <Choice
            legend="Ambiance"
            name="remix-ambience"
            value={ambience}
            columns={2}
            onChange={(id) => {
              setAmbience(id);
              setGainDb(getAmbience(id)?.defaultGainDb ?? -6);
            }}
            options={AMBIENCES.map((a) => ({ value: a.id, label: a.label }))}
          />
          <label className="block space-y-3">
            <span className="text-muted-foreground flex justify-between text-sm">
              <span>Niveau</span>
              <span className="tabular">{gainDb} dB</span>
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
          <Button
            className="w-full"
            onClick={() => {
              setOpen(false);
              onSubmit({ courseId: course.id, ambience, ambienceGainDb: gainDb });
            }}
          >
            Refaire le pré-mix
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
