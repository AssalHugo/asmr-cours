import { TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import type { Course } from "@/lib/data";
import { formatDate, formatDuration } from "@/lib/format";
import { isActive, STATUS_LABEL } from "@/lib/pipeline/status";
import { OfflineBadge } from "./offline-badge";

export function CourseCard({
  course,
  positionMs,
  flagged,
  sharedBy,
}: {
  course: Course;
  positionMs: number;
  flagged: boolean;
  /** Adresse de la personne qui partage ce cours, `null` pour ses propres cours. */
  sharedBy: string | null;
}) {
  const ready = course.status === "ready";
  const listened = ready && course.duration_ms ? Math.min(1, positionMs / course.duration_ms) : 0;
  return (
    <Link
      href={ready ? `/play/${course.id}` : `/courses/${course.id}`}
      className="bg-card hover:bg-accent block rounded-3xl p-5 shadow-[0_18px_60px_-30px_rgb(0_0_0/0.6)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl leading-snug">{course.title}</h2>
        {flagged ? (
          <span className="text-sand mt-1 shrink-0" title="Fidélité à vérifier">
            <TriangleAlert className="size-5" aria-label="Fidélité à vérifier sur une section" />
          </span>
        ) : null}
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
    </Link>
  );
}
