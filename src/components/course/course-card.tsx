import { Folder as FolderIcon, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { MoveToFolder, type FolderOption } from "@/components/folder/folder-dialogs";
import type { Course } from "@/lib/data";
import { formatDate, formatDuration } from "@/lib/format";
import { isActive, STATUS_LABEL } from "@/lib/pipeline/status";
import { OfflineBadge } from "./offline-badge";

export function CourseCard({
  course,
  positionMs,
  flagged,
  sharedBy,
  folders,
  folderId,
  showFolder,
}: {
  course: Course;
  positionMs: number;
  flagged: boolean;
  /** Adresse de la personne qui partage ce cours, `null` pour ses propres cours. */
  sharedBy: string | null;
  folders: FolderOption[];
  /** Dossier où ce compte a rangé le cours, `null` s'il n'est rangé nulle part. */
  folderId: string | null;
  /** Affiche le nom du dossier : inutile quand la liste est déjà celle d'un dossier. */
  showFolder: boolean;
}) {
  const ready = course.status === "ready";
  const listened = ready && course.duration_ms ? Math.min(1, positionMs / course.duration_ms) : 0;
  const folder = folders.find((f) => f.id === folderId) ?? null;
  return (
    // Le lien du titre couvre toute la carte ; le bouton de rangement passe au-dessus.
    <div className="bg-card hover:bg-accent relative rounded-3xl p-5 shadow-[0_18px_60px_-30px_rgb(0_0_0/0.6)] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl leading-snug">
          <Link
            href={ready ? `/play/${course.id}` : `/courses/${course.id}`}
            className="focus-visible:after:ring-ring/50 outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-3"
          >
            {course.title}
          </Link>
        </h2>
        <div className="relative z-10 -mt-2 -mr-2 flex shrink-0 items-center gap-1">
          {flagged ? (
            <span className="text-sand" title="Fidélité à vérifier">
              <TriangleAlert className="size-5" aria-label="Fidélité à vérifier sur une section" />
            </span>
          ) : null}
          <MoveToFolder
            courseId={course.id}
            courseTitle={course.title}
            folders={folders}
            folderId={folderId}
            compact
          />
        </div>
      </div>
      <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 text-sm">
        {ready && course.duration_ms ? <span>{formatDuration(course.duration_ms)}</span> : null}
        {ready ? <span aria-hidden>·</span> : null}
        <span>{formatDate(course.created_at)}</span>
        {!ready ? (
          <>
            <span aria-hidden>·</span>
            <span className={course.status === "failed" ? "text-destructive" : "text-lavender"}>
              {STATUS_LABEL[course.status]}
              {isActive(course.status) ? ` · ${course.progress} %` : ""}
            </span>
          </>
        ) : null}
        {ready ? <OfflineBadge courseId={course.id} /> : null}
        {showFolder && folder ? (
          <span className="flex basis-full items-center gap-1">
            <FolderIcon className="size-4" aria-hidden />
            {folder.name}
          </span>
        ) : null}
        {sharedBy ? (
          <span className="text-lavender flex basis-full items-center gap-1">
            <Users className="size-4" aria-hidden />
            Partagé par {sharedBy}
          </span>
        ) : null}
      </p>
      {ready ? (
        <div
          className="bg-muted mt-4 h-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Progression d'écoute"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(listened * 100)}
        >
          <div className="bg-sand h-full rounded-full" style={{ width: `${listened * 100}%` }} />
        </div>
      ) : isActive(course.status) ? (
        <div className="bg-muted mt-4 h-1 overflow-hidden rounded-full">
          <div
            className="bg-lavender h-full rounded-full transition-[width] duration-700"
            style={{ width: `${course.progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
