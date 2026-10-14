import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MODE_LABEL, QUALITY_LABEL, SOURCE_LABEL, TIER_LABEL } from "@/components/admin/labels";
import { SpendBreakdown } from "@/components/admin/spend-breakdown";
import { VoiceMessageList } from "@/components/admin/voice-message-list";
import { VoiceMessageRecorder } from "@/components/admin/voice-message-recorder";
import { PageHeader } from "@/components/page-header";
import { getAdminCourse } from "@/lib/admin";
import { getAmbience } from "@/lib/ambiences";
import { requireAdmin } from "@/lib/auth";
import { formatCount, formatDateTime, formatDuration, formatUsd } from "@/lib/format";
import { Script, VerifyReport } from "@/lib/pipeline/schemas";
import { isActive, STATUS_LABEL } from "@/lib/pipeline/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · cours" };

export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const detail = await getAdminCourse(id.data);
  if (!detail) notFound();
  const { course, sections, breakdown, voiceLabel, ownerEmail, messages } = detail;
  const ambience = getAmbience(course.ambience);
  const estUsd = course.est_cost_usd === null ? null : Number(course.est_cost_usd);

  const facts: [string, string][] = [
    ["Compte", ownerEmail ?? "compte supprimé"],
    ["Créé le", formatDateTime(course.created_at)],
    [
      "Source",
      `${SOURCE_LABEL[course.source_kind] ?? course.source_kind}${course.source_chars ? ` · ${formatCount(course.source_chars)} caractères` : ""}`,
    ],
    ["Voix", `${voiceLabel ?? "—"} · ${MODE_LABEL[course.mode]}`],
    ["Formule", `${TIER_LABEL[course.tier]} · qualité ${QUALITY_LABEL[course.quality]}`],
    ["Ambiance", `${ambience?.label ?? course.ambience} (${Number(course.ambience_gain_db)} dB)`],
    ["Adresse", course.address_form === "vous" ? "Vouvoiement" : "Tutoiement"],
    ["Durée", course.duration_ms ? formatDuration(course.duration_ms) : "—"],
  ];

  return (
    <main className="space-y-10">
      <PageHeader title={course.title} back={{ href: "/admin/courses", label: "Tous les cours" }} />

      <section className="bg-card space-y-4 rounded-3xl p-5">
        <p
          className={cn(
            "text-lg",
            course.status === "failed"
              ? "text-destructive"
              : course.status === "ready"
                ? "text-sand"
                : "text-lavender",
          )}
        >
          {STATUS_LABEL[course.status]}
          {isActive(course.status) ? ` · ${course.progress} %` : ""}
        </p>
        {course.error ? <p className="text-destructive text-sm">{course.error}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {course.status === "ready" ? (
        <section className="space-y-3">
          <h2 className="text-2xl">Écouter</h2>
          <p className="text-muted-foreground text-sm">Voix seule</p>
          <audio
            controls
            preload="none"
            className="w-full"
            src={`/api/audio/${course.id}/voice.m4a`}
          />
          {ambience ? (
            <>
              <p className="text-muted-foreground text-sm">Avec l&apos;ambiance {ambience.label}</p>
              <audio
                controls
                preload="none"
                className="w-full"
                src={`/api/audio/${course.id}/mix-${ambience.id}.m4a`}
              />
            </>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-2xl">Messages vocaux</h2>
        <VoiceMessageRecorder courseId={course.id} courseDurationMs={course.duration_ms} />
        <VoiceMessageList messages={messages} />
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl">Coût</h2>
          <p className="tabular">
            {formatUsd(course.realUsd, 3)}
            {estUsd !== null ? (
              <span className="text-muted-foreground text-sm">
                {" "}
                · estimé {formatUsd(estUsd, 3)}
              </span>
            ) : null}
          </p>
        </div>
        <SpendBreakdown rows={breakdown} />
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Sections</h2>
        {sections.length === 0 ? (
          <p className="text-muted-foreground">Pas encore de section.</p>
        ) : (
          <ol className="space-y-3">
            {sections.map((s) => {
              const report = VerifyReport.safeParse(s.verify_report);
              const script = Script.safeParse(s.script);
              const issues = report.success
                ? [
                    ...report.data.missingFacts,
                    ...report.data.alteredFacts,
                    ...report.data.inventedClaims,
                  ]
                : [];
              return (
                <li key={s.id} className="bg-card space-y-3 rounded-3xl p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg leading-snug">
                      {s.idx + 1}. {s.title}
                    </h3>
                    {s.duration_ms ? (
                      <span className="text-muted-foreground tabular shrink-0 text-sm">
                        {formatDuration(s.duration_ms)}
                      </span>
                    ) : null}
                  </div>
                  {issues.length > 0 ? (
                    <div className="text-sand space-y-1 text-sm">
                      <p className="flex items-center gap-2">
                        <TriangleAlert className="size-4" aria-hidden />
                        Fidélité à vérifier
                      </p>
                      <ul className="text-muted-foreground list-disc pl-5">
                        {issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <details className="text-sm">
                    <summary className="text-muted-foreground cursor-pointer">
                      Texte source · {formatCount(s.source_text.length)} caractères
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap">{s.source_text}</p>
                  </details>
                  {script.success ? (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer">
                        Script lu · {script.data.segments.length} segments
                      </summary>
                      <div className="mt-2 space-y-2">
                        {script.data.segments.map((seg, i) => (
                          <p key={i} className="whitespace-pre-wrap">
                            {seg.text}
                          </p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
