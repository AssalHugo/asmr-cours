import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BinderView } from "@/components/binder/binder-view";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import {
  billingModels,
  getBinder,
  getMonthlySpend,
  getProfile,
  listCourseProgress,
  listMeasured,
  listVoices,
} from "@/lib/data";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Classeur" };
export const maxDuration = 60;

export default async function BinderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const found = await getBinder(id.data);
  if (!found) notFound();
  const { binder, lessons } = found;

  const courseIds = [
    ...lessons.flatMap((l) => (l.course_id ? [l.course_id] : [])),
    ...(binder.sample_course_id ? [binder.sample_course_id] : []),
  ];
  const [profile, voices, spentUsd, measured, courses] = await Promise.all([
    getProfile(user.id),
    listVoices(user.id),
    getMonthlySpend(),
    listMeasured(user.id),
    listCourseProgress(courseIds),
  ]);
  const e = env();
  const { models, mock } = billingModels();
  const chosen = lessons.filter((l) => l.selected).length;

  return (
    <main>
      <PageHeader
        title={binder.title}
        back={{ href: "/library", label: "Bibliothèque" }}
        lead={`${binder.pages} pages · ${lessons.length} leçons${
          binder.status === "draft" ? ` dont ${chosen} cochées` : ""
        } · ${
          binder.detection === "toc"
            ? "trouvées dans le sommaire"
            : binder.detection === "outline"
              ? "trouvées dans les signets du PDF"
              : "découpées par tranches de pages, à ajuster"
        }`}
      />
      <BinderView
        binder={binder}
        lessons={lessons}
        courses={courses}
        voices={voices.map((v) => ({ id: v.id, label: v.label, description: v.description }))}
        defaults={{
          voiceId: profile.default_voice_id,
          mode: profile.default_mode,
          ambience: profile.default_ambience,
          tier: profile.default_tier,
          quality: profile.default_quality,
          addressForm: profile.address_form === "vous" ? "vous" : "tu",
        }}
        budget={{ spentUsd, budgetUsd: Number(profile.monthly_budget_usd) }}
        models={models}
        mock={mock}
        measured={measured}
        limits={{ maxPages: e.MAX_PDF_PAGES, maxChars: e.MAX_SOURCE_CHARS }}
      />
    </main>
  );
}
