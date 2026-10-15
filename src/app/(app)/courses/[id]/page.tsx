import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CourseView, type MarkView, type SectionView } from "@/components/course/course-view";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import {
  getCourse,
  listCourseFolders,
  listFolders,
  listPassageMarks,
  listPassages,
  listSections,
  listSharedWithMe,
  listShareRecipients,
  listVoiceMessages,
} from "@/lib/data";
import { formatClock, formatDate } from "@/lib/format";
import { findMarkedPassage } from "@/lib/pipeline/passage";
import { VerifyReport } from "@/lib/pipeline/schemas";

export const metadata: Metadata = { title: "Cours" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const course = await getCourse(id.data);
  if (!course) notFound();
  const owned = course.user_id === user.id;
  const [recipients, sharedBy, folders, placements, messages] = await Promise.all([
    owned ? listShareRecipients(course.id, user.id) : [],
    owned ? null : listSharedWithMe(user.id).then((shared) => shared.get(course.id) ?? null),
    listFolders(),
    listCourseFolders(),
    owned ? listVoiceMessages(course.id, user.id) : [],
  ]);
  // Les messages pas encore entendus restent une surprise : ils passent dans le lecteur.
  const heard = messages.filter((m) => m.played_at !== null);

  // Passages et marques ne servent qu'à refaire ou réexpliquer un passage : inutiles pour un
  // cours en préparation.
  const ready = owned && course.status === "ready";
  const [passages, rows, marks] = await Promise.all([
    ready ? listPassages(course.id) : [],
    listSections(course.id),
    ready ? listPassageMarks(course.id, user.id) : [],
  ]);
  // Le quiz ne se réexplique pas : une marque n'y renvoie qu'au texte du cours.
  const speech = passages.filter((p) => p.kind === "speech");
  const markViews: MarkView[] = marks.map((mark) => {
    const passage = findMarkedPassage(speech, mark);
    return {
      id: mark.id,
      caption: mark.caption,
      positionMs: passage?.start_ms ?? mark.position_ms,
      chapter: rows.find((s) => s.id === passage?.section_id)?.title ?? null,
      stale: passage === null,
    };
  });
  const sections: SectionView[] = rows.map((s) => {
    const report = VerifyReport.safeParse(s.verify_report);
    return {
      id: s.id,
      title: s.title,
      durationMs: s.duration_ms,
      verified: s.verified,
      checked: s.verify_report !== null,
      report: report.success ? report.data : null,
      passages: passages
        .filter((p) => p.section_id === s.id)
        .map((p) => ({ id: p.id, caption: p.caption, startMs: p.start_ms })),
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
        marks={markViews}
        owned={owned}
        recipients={recipients}
        folders={folders}
        folderId={placements.get(course.id) ?? null}
      />
      {heard.length > 0 ? (
        <section className="mt-12 space-y-4">
          <h2 className="text-2xl">Messages pour toi</h2>
          <ul className="space-y-3">
            {heard.map((m) => (
              <li key={m.id} className="bg-card space-y-3 rounded-3xl p-5">
                <p className="text-muted-foreground text-sm">
                  {m.at_ms === null ? "Au lancement" : `À ${formatClock(m.at_ms)}`} · laissé le{" "}
                  {formatDate(m.created_at)}
                </p>
                <audio controls preload="none" src={`/api/messages/${m.id}`} className="w-full" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
