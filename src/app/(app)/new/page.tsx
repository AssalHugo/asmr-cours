import type { Metadata } from "next";
import { NewCourseWizard } from "@/components/course/new-course-wizard";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { billingModels, getMonthlySpend, getProfile, listMeasured, listVoices } from "@/lib/data";
import { env } from "@/lib/env";
import { MAX_IMAGES } from "@/lib/uploads";

export const metadata: Metadata = { title: "Nouveau cours" };

export default async function NewCoursePage() {
  const user = await requireUser();
  const [profile, voices, spentUsd, measured] = await Promise.all([
    getProfile(user.id),
    listVoices(user.id),
    getMonthlySpend(),
    listMeasured(user.id),
  ]);
  const e = env();
  const { models, mock } = billingModels();

  return (
    <main>
      <PageHeader title="Nouveau cours" />
      <NewCourseWizard
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
        limits={{
          maxUploadMb: e.MAX_UPLOAD_MB,
          maxPdfPages: e.MAX_PDF_PAGES,
          maxSourceChars: e.MAX_SOURCE_CHARS,
          maxImages: MAX_IMAGES,
        }}
      />
    </main>
  );
}
