"use client";

import {
  ChevronDown,
  Gauge,
  Loader2,
  Lock,
  MessageCircleQuestionMark,
  MoonStar,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Text,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { markPassage } from "@/app/(app)/actions";
import { BreathOrb } from "@/components/breath-orb";
import { Choice } from "@/components/choice";
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
import { readLocalPosition, usePlayer } from "@/hooks/use-player";
import { AMBIENCES, getAmbience } from "@/lib/ambiences";
import { formatClock } from "@/lib/format";
import type { PlayerSources } from "@/lib/player/engine";
import { Caption, type Chapter } from "@/lib/pipeline/schemas";
import {
  captionIndexAt,
  PLAYBACK_RATES,
  resumePosition,
  SEEK_STEP_MS,
  SLEEP_MINUTES,
} from "@/lib/player/timeline";
import { cn } from "@/lib/utils";

export type PlayerProps = {
  userId: string;
  course: { id: string; title: string; durationMs: number; ambience: string };
  chapters: Chapter[];
  /** Position enregistrée côté serveur (`playback_progress`). */
  serverPosition: { positionMs: number; updatedAt: number } | null;
  /** « Je n'ai pas compris ce passage » : seulement pour un cours à soi, seul réexplicable. */
  canMark: boolean;
};

export function Player({ userId, course, chapters, serverPosition, canMark }: PlayerProps) {
  const sources: PlayerSources = {
    courseId: course.id,
    title: course.title,
    durationMs: course.durationMs,
    chapters,
    voiceUrl: `/api/audio/${course.id}/voice.m4a`,
    mixUrl: `/api/audio/${course.id}/mix-${course.ambience}.m4a`,
    ambienceUrl: (id) => `/api/audio/ambience/${id}.m4a`,
    artworkUrl: "/icons/icon-512.png",
  };
  const { snapshot, engine } = usePlayer(sources, {
    userId,
    ambienceId: course.ambience,
    positionMs: 0,
  });

  // Reprise : la position la plus récente entre l'appareil et le serveur.
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  useEffect(() => {
    const local = readLocalPosition(course.id);
    const latest = [local, serverPosition]
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const frame = requestAnimationFrame(() =>
      setResumeAt(latest ? resumePosition(latest.positionMs, course.durationMs) : null),
    );
    return () => cancelAnimationFrame(frame);
  }, [course.id, course.durationMs, serverPosition]);

  const [showText, setShowText] = useState(false);
  const captions = useCaptions(course.id, showText);

  // Le passage en cours est le chunk dont la légende de captions.json a commencé en dernier.
  const [marking, setMarking] = useState(false);
  async function markCurrentPassage() {
    const positionMs = snapshot.positionMs;
    setMarking(true);
    try {
      const list = captions ?? (await fetchCaptions(course.id));
      const caption = list[captionIndexAt(list, positionMs)];
      if (!caption) {
        toast.error("Aucun passage à cet endroit de la piste.");
        return;
      }
      const result = await markPassage({
        courseId: course.id,
        positionMs: caption.startMs,
        caption: caption.text,
      });
      if (!result.ok) toast.error(result.message);
      else if (result.data.already) toast("Ce passage est déjà noté.");
      else toast.success("Passage noté. Fais-le réexpliquer depuis la page du cours.");
    } catch {
      toast.error("Ce passage n'a pas pu être noté. Es-tu hors ligne ?");
    } finally {
      setMarking(false);
    }
  }

  const playing = snapshot.phase === "playing";
  const loading = snapshot.phase === "loading";
  const chapter = chapters[snapshot.chapterIndex];
  const ready = engine !== null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between">
        <Button asChild variant="ghost" size="icon" className="-ml-3">
          <Link href={`/courses/${course.id}`} aria-label="Fermer le lecteur">
            <ChevronDown aria-hidden />
          </Link>
        </Button>
        {snapshot.sleep.kind !== "off" && snapshot.sleepRemainingMs !== null ? (
          <p className="text-lavender tabular flex items-center gap-1.5 text-sm" role="status">
            <MoonStar className="size-4" aria-hidden />
            Arrêt dans {formatClock(snapshot.sleepRemainingMs)}
          </p>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-6 text-center">
        {showText ? (
          <CaptionView captions={captions} positionMs={snapshot.positionMs} />
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {chapters.length > 1
                ? `Chapitre ${snapshot.chapterIndex + 1} sur ${chapters.length}`
                : " "}
            </p>
            <h1 className="line-clamp-3 text-3xl leading-tight">
              {chapter?.title ?? course.title}
            </h1>
            <p className="text-muted-foreground line-clamp-1">{course.title}</p>
          </div>
        )}

        {resumeAt !== null && snapshot.positionMs < 1000 && !playing ? (
          <div className="bg-card flex flex-wrap items-center justify-center gap-2 rounded-2xl p-3">
            <Button
              size="sm"
              onClick={() => {
                engine?.seek(resumeAt);
                setResumeAt(null);
                void engine?.play();
              }}
            >
              Reprendre à {formatClock(resumeAt)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResumeAt(null)}>
              Depuis le début
            </Button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setResumeAt(null);
            engine?.toggle();
          }}
          disabled={!ready}
          aria-label={playing || loading ? "Mettre en pause" : "Lire"}
          className="rounded-full disabled:opacity-60"
        >
          <BreathOrb size="lg" breathing={playing}>
            {loading ? (
              <Loader2 className="size-12 animate-spin" aria-hidden />
            ) : playing ? (
              <Pause className="size-12" fill="currentColor" aria-hidden />
            ) : (
              <Play className="ml-1.5 size-12" fill="currentColor" aria-hidden />
            )}
          </BreathOrb>
        </button>

        {snapshot.error ? (
          <p role="alert" className="text-destructive max-w-xs text-sm">
            {snapshot.error}
          </p>
        ) : null}
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <Slider
            value={[Math.min(snapshot.positionMs, course.durationMs)]}
            min={0}
            max={course.durationMs}
            step={1000}
            disabled={!ready}
            onValueChange={([value]) => engine?.seek(value ?? 0)}
            aria-label="Position dans la piste"
            aria-valuetext={formatClock(snapshot.positionMs)}
          />
          <div className="text-muted-foreground tabular flex justify-between text-sm">
            <span>{formatClock(snapshot.positionMs)}</span>
            <span>−{formatClock(Math.max(0, course.durationMs - snapshot.positionMs))}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            disabled={!ready}
            onClick={() => engine?.previousChapter()}
            aria-label="Chapitre précédent"
          >
            <SkipBack aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            disabled={!ready}
            onClick={() => engine?.seekBy(-SEEK_STEP_MS)}
            aria-label="Reculer de 15 secondes"
          >
            <RotateCcw className="size-7" aria-hidden />
          </Button>
          <span className="text-muted-foreground tabular text-xs" aria-hidden>
            15 s
          </span>
          <Button
            variant="ghost"
            size="icon-lg"
            disabled={!ready}
            onClick={() => engine?.seekBy(SEEK_STEP_MS)}
            aria-label="Avancer de 15 secondes"
          >
            <RotateCw className="size-7" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!ready || snapshot.chapterIndex >= chapters.length - 1}
            onClick={() => engine?.nextChapter()}
            aria-label="Chapitre suivant"
          >
            <SkipForward aria-hidden />
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="tabular"
                aria-label={`Vitesse : ${snapshot.rate}`}
              >
                <Gauge aria-hidden />
                {snapshot.rate.toFixed(1).replace(".", ",")}×
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Vitesse</DialogTitle>
                <DialogDescription>La hauteur de la voix ne change pas.</DialogDescription>
              </DialogHeader>
              <Choice
                legend="Vitesse de lecture"
                name="rate"
                columns={3}
                value={String(snapshot.rate)}
                onChange={(value) => engine?.setRate(Number(value))}
                options={PLAYBACK_RATES.map((r) => ({
                  value: String(r),
                  label: `${r.toFixed(1).replace(".", ",")}×`,
                }))}
              />
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Minuteur de sommeil"
                className={cn(snapshot.sleep.kind !== "off" && "text-lavender")}
              >
                <MoonStar aria-hidden />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Minuteur de sommeil</DialogTitle>
                <DialogDescription>
                  Le son s&apos;éteint en douceur sur les 30 dernières secondes.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {SLEEP_MINUTES.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="secondary"
                    onClick={() => engine?.setSleep(minutes)}
                  >
                    {minutes} min
                  </Button>
                ))}
                <Button
                  variant="secondary"
                  className="col-span-2"
                  onClick={() => engine?.setSleep("chapter")}
                >
                  À la fin du chapitre
                </Button>
                {snapshot.sleep.kind !== "off" ? (
                  <Button
                    variant="ghost"
                    className="col-span-2"
                    onClick={() => engine?.setSleep(null)}
                  >
                    Annuler le minuteur
                  </Button>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>

          {canMark ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={!ready || marking || snapshot.positionMs <= 0}
              aria-label="Je n'ai pas compris ce passage"
              title="Je n'ai pas compris ce passage"
              onClick={() => void markCurrentPassage()}
            >
              {marking ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <MessageCircleQuestionMark aria-hidden />
              )}
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            aria-pressed={showText}
            aria-label="Afficher le texte"
            className={cn(showText && "text-sand")}
            onClick={() => setShowText((value) => !value)}
          >
            <Text aria-hidden />
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mix et ambiance">
                <SlidersHorizontal aria-hidden />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mix</DialogTitle>
                <DialogDescription>
                  {snapshot.lockMode
                    ? `Mode écran verrouillé : l'ambiance est celle du pré-mix (${getAmbience(course.ambience)?.label ?? course.ambience}).`
                    : "Règle la voix et l'ambiance séparément."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <LevelSlider
                  label="Voix"
                  value={snapshot.voiceLevel}
                  onChange={(v) => engine?.setVoiceLevel(v)}
                />
                {!snapshot.lockMode ? (
                  <>
                    <LevelSlider
                      label="Ambiance"
                      value={snapshot.ambienceLevel}
                      onChange={(v) => engine?.setAmbienceLevel(v)}
                    />
                    <Choice
                      legend="Ambiance"
                      name="live-ambience"
                      columns={2}
                      value={snapshot.ambienceId}
                      onChange={(id) => engine?.setAmbience(id)}
                      options={AMBIENCES.map((a) => ({ value: a.id, label: a.label }))}
                    />
                  </>
                ) : null}
                <label className="bg-card flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl p-4">
                  <input
                    type="checkbox"
                    className="accent-sand size-5"
                    checked={snapshot.lockMode}
                    onChange={(event) => engine?.setLockMode(event.target.checked)}
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2">
                      <Lock className="size-4" aria-hidden />
                      Mode écran verrouillé
                    </span>
                    <span className="text-muted-foreground block text-sm">
                      Continue de jouer téléphone verrouillé, avec l&apos;ambiance du pré-mix.
                    </span>
                  </span>
                </label>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function LevelSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-3">
      <span className="text-muted-foreground flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular">{Math.round(value * 100)} %</span>
      </span>
      <Slider
        value={[Math.round(value * 100)]}
        min={0}
        max={100}
        step={1}
        onValueChange={([next]) => onChange((next ?? 0) / 100)}
        aria-label={`Niveau : ${label}`}
      />
    </label>
  );
}

/** Sous-titres du cours (un par passage) ; liste vide s'ils sont illisibles. */
async function fetchCaptions(courseId: string): Promise<Caption[]> {
  const res = await fetch(`/api/audio/${courseId}/captions.json`);
  const parsed = Caption.array().safeParse(res.ok ? await res.json() : []);
  return parsed.success ? parsed.data : [];
}

/** Sous-titres du cours, chargés à la première ouverture du texte. */
function useCaptions(courseId: string, enabled: boolean): Caption[] | null {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  useEffect(() => {
    if (!enabled || captions) return;
    let alive = true;
    void fetchCaptions(courseId)
      .then((list) => alive && setCaptions(list))
      .catch(() => alive && setCaptions([]));
    return () => {
      alive = false;
    };
  }, [courseId, enabled, captions]);
  return captions;
}

/** « Afficher le texte » : le passage en cours, entouré de ses voisins, avec un défilement doux. */
function CaptionView({ captions, positionMs }: { captions: Caption[] | null; positionMs: number }) {
  const index = captions ? captionIndexAt(captions, positionMs) : -1;
  const current = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  if (!captions) return <p className="text-muted-foreground">Chargement du texte…</p>;
  if (captions.length === 0)
    return <p className="text-muted-foreground">Le texte de ce cours n&apos;est pas disponible.</p>;
  const from = Math.max(0, index - 1);
  return (
    <div
      className="max-h-[38dvh] w-full [scrollbar-width:none] overflow-y-auto [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)] py-10 text-left"
      aria-live="off"
    >
      {captions.slice(from, index + 3).map((caption, offset) => {
        const active = from + offset === index;
        return (
          <p
            key={caption.startMs}
            ref={active ? current : undefined}
            className={cn(
              "font-heading py-3 text-xl leading-relaxed transition-colors duration-700",
              active ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            {caption.text}
          </p>
        );
      })}
    </div>
  );
}
