import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CourseView, type SectionView } from "@/components/course/course-view";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import {
  getCourse,
  listCourseFolders,
  listFolders,
  listSections,
  listSharedWithMe,
  listShareRecipients,
} from "@/lib/data";
import { VerifyReport } from "@/lib/pipeline/schemas";

export const metadata: Metadata = { title: "Cours" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const course = await getCourse(id.data);
  if (!course) notFound();
  const owned = course.user_id === user.id;
  const [recipients, sharedBy, folders, placements] = await Promise.all([
    owned ? listShareRecipients(course.id, user.id) : [],
    owned ? null : listSharedWithMe(user.id).then((shared) => shared.get(course.id) ?? null),
    listFolders(),
    listCourseFolders(),
  ]);

  const sections: SectionView[] = (await listSections(course.id)).map((s) => {
    const report = VerifyReport.safeParse(s.verify_report);
    return {
      id: s.id,
      title: s.title,
      durationMs: s.duration_ms,
      verified: s.verified,
      checked: s.verify_report !== null,
      report: report.success ? report.data : null,
    };
  });

  return (
    <main>
      <PageHeader
        title={course.title}
        lead={owned ? undefined : `Partagé par ${sharedBy ?? "un autre compte"}`}
        back={{ href: "/library", label: "Bibliothèque" }}
      />
      <CourseView
        key={`${course.status}-${course.updated_at}`}
        course={{
          id: course.id,
          title: course.title,
          status: course.status,
          progress: course.progress,
          error: course.error,
          tier: course.tier,
          ambience: course.ambience,
          ambienceGainDb: Number(course.ambience_gain_db),
          durationMs: course.duration_ms,
          estUsd: course.est_cost_usd === null ? null : Number(course.est_cost_usd),
          actualUsd: Number(course.actual_cost_usd),
        }}
        sections={sections}
        owned={owned}
        recipients={recipients}
        folders={folders}
        folderId={placements.get(course.id) ?? null}
      />
    </main>
  );
}
