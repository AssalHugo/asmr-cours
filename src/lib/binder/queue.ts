import "server-only";
import { isAmbienceInstalled } from "@/lib/audio/ambience-synth";
import { billingModels } from "@/lib/billing";
import { checkBudget } from "@/lib/budget";
import { CourseSettings } from "@/lib/course-input";
import { env } from "@/lib/env";
import { comboKey, estimateCourse } from "@/lib/estimate";
import { startJob } from "@/lib/jobs";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { GLOBAL_BUDGET_MESSAGE } from "@/trigger/steps/context";

/**
 * File d'attente des classeurs : une leçon à la fois, lancée dès que plus aucun cours n'est en
 * préparation. Appelée à la fin de chaque tâche de cours (Trigger.dev ou inline) et par les
 * actions du classeur. Clé secrète, sans session : tout est filtré par `user_id`.
 */

type Tables = Database["public"]["Tables"];
type BinderRow = Tables["binders"]["Row"];
type LessonRow = Tables["binder_lessons"]["Row"];
type Admin = ReturnType<typeof createAdminClient>;

export type AdvanceResult = { launchedCourseId: string | null; pausedMessage?: string };

/** Lancée depuis une tâche Trigger.dev : le SDK y est déjà authentifié. */
export type QueueOptions = { fromTask?: boolean };

const ONE_ACTIVE_INDEX = "courses_one_active_per_user";

const usd = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

function monthStart(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
}

/** Lance la leçon suivante du plus ancien classeur en cours, si rien n'est en préparation. */
export async function advanceBinders(
  userId: string,
  opts: QueueOptions = {},
): Promise<AdvanceResult> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("status", "in", "(ready,failed)");
  // Un cours en préparation : il relancera la file en se terminant.
  if (error || (count ?? 0) > 0) return { launchedCourseId: null };

  const { data: binders } = await admin
    .from("binders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("created_at");
  for (const binder of binders ?? []) {
    const { data: next } = await admin
      .from("binder_lessons")
      .select("*")
      .eq("binder_id", binder.id)
      .eq("state", "queued")
      .order("idx")
      .limit(1)
      .maybeSingle();
    if (next) return launchLesson(admin, binder, next, opts);
    await admin
      .from("binders")
      .update({ status: "done", error: null })
      .eq("id", binder.id)
      .eq("status", "running");
  }
  return { launchedCourseId: null };
}

async function launchLesson(
  admin: Admin,
  binder: BinderRow,
  lesson: LessonRow,
  opts: QueueOptions,
): Promise<AdvanceResult> {
  const pause = async (message: string): Promise<AdvanceResult> => {
    await admin.from("binders").update({ status: "paused", error: message }).eq("id", binder.id);
    return { launchedCourseId: null, pausedMessage: message };
  };
  const userId = binder.user_id;
  const parsed = CourseSettings.safeParse(binder.settings);
  if (!parsed.success) return pause("Les réglages de ce classeur sont à refaire.");
  const settings = parsed.data;
  if (!lesson.source_key) return pause(`Les pages de « ${lesson.title} » sont introuvables.`);

  const e = env();
  const { models, mock } = billingModels();
  const { data: voice } = await admin
    .from("voices")
    .select("id, env")
    .eq("id", settings.voiceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!voice || voice.env !== e.APP_ENV) {
    return pause("La voix choisie n'est plus disponible. Choisis-en une autre pour la suite.");
  }
  if (!(await isAmbienceInstalled(storage(), settings.ambience, mock))) {
    return pause("L'ambiance choisie n'est pas installée. Choisis-en une autre pour la suite.");
  }

  const { data: measured } = await admin
    .from("courses")
    .select("source_chars, duration_ms")
    .eq("user_id", userId)
    .eq("status", "ready")
    .eq("voice_id", settings.voiceId)
    .eq("mode", settings.mode)
    .limit(10);
  const at = new Date();
  const estimate = estimateCourse({
    sourceChars: lesson.chars,
    sourceKind: "pdf",
    pages: lesson.last_page - lesson.first_page + 1,
    mode: settings.mode,
    quiz: settings.quiz,
    measured: (measured ?? []).flatMap((m) =>
      m.source_chars && m.duration_ms
        ? [{ sourceChars: m.source_chars, durationMs: m.duration_ms }]
        : [],
    ),
    models,
    at,
    mock,
  });
  const estimateUsd = estimate.combos[comboKey(settings.tier, settings.quality)].totalUsd;

  // Plafond dur seulement : les 80 % ont été confirmés au lancement de la file.
  const [profile, spent, globalSpent] = await Promise.all([
    admin.from("profiles").select("monthly_budget_usd").eq("id", userId).maybeSingle(),
    admin.rpc("spend_since", { p_since: monthStart(at), p_user_id: userId }),
    e.GLOBAL_MONTHLY_BUDGET_USD === undefined
      ? Promise.resolve({ data: 0, error: null })
      : admin.rpc("spend_since", { p_since: monthStart(at) }),
  ]);
  if (profile.error || spent.error || globalSpent.error) {
    return pause("Le budget n'a pas pu être vérifié. Relance la file dans un instant.");
  }
  const budgetUsd = Number(profile.data?.monthly_budget_usd ?? 0);
  const decision = checkBudget({
    spentUsd: Number(spent.data),
    estimateUsd,
    budgetUsd,
    tier: "eco",
    confirmed: true,
  });
  if (!decision.ok) {
    return pause(
      `Budget du mois atteint : « ${lesson.title} » coûterait environ ${usd(estimateUsd)} et il reste ${usd(decision.remainingUsd)}. Relance la file le mois prochain, ou après avoir augmenté le budget.`,
    );
  }
  if (
    e.GLOBAL_MONTHLY_BUDGET_USD !== undefined &&
    Number(globalSpent.data) + estimateUsd > e.GLOBAL_MONTHLY_BUDGET_USD
  ) {
    return pause(GLOBAL_BUDGET_MESSAGE);
  }

  const courseId = lesson.planned_course_id;
  const { error } = await admin.from("courses").insert({
    id: courseId,
    user_id: userId,
    title: lesson.title,
    source_kind: "pdf",
    source_keys: [lesson.source_key],
    source_chars: binder.scanned ? null : lesson.chars,
    mode: settings.mode,
    tier: settings.tier,
    quality: settings.quality,
    voice_id: settings.voiceId,
    ambience: settings.ambience,
    ambience_gain_db: settings.ambienceGainDb,
    address_form: settings.addressForm,
    quiz: settings.quiz,
    est_cost_usd: Number(estimateUsd.toFixed(4)),
  });
  if (error) {
    // Un autre cours vient de démarrer : il relancera la file en se terminant.
    if (error.message.includes(ONE_ACTIVE_INDEX)) return { launchedCourseId: null };
    return pause(`« ${lesson.title} » n'a pas pu être créée. Retire-la de la file pour continuer.`);
  }
  await admin
    .from("binder_lessons")
    .update({ state: "launched", course_id: courseId })
    .eq("id", lesson.id);
  if (binder.folder_id) {
    await admin
      .from("course_folders")
      .upsert(
        { user_id: userId, course_id: courseId, folder_id: binder.folder_id },
        { onConflict: "user_id,course_id", ignoreDuplicates: true },
      );
  }

  try {
    const { runId } = await startJob(
      { kind: "generate-course", payload: { courseId, userId, titleIsDefault: false } },
      { fromTask: opts.fromTask },
    );
    await admin.from("courses").update({ trigger_run_id: runId }).eq("id", courseId);
  } catch (cause) {
    const message =
      cause instanceof Error && cause.name === "MissingEnvError"
        ? cause.message
        : "Le lancement a échoué. Réessaie dans un instant.";
    await admin.from("courses").update({ status: "failed", error: message }).eq("id", courseId);
    return pause(`« ${lesson.title} » n'a pas pu démarrer : ${message}`);
  }
  return { launchedCourseId: courseId };
}

/**
 * Fin d'une tâche de cours : une leçon en échec met son classeur en pause (inutile de payer la
 * suite d'un problème qui se répéterait), puis la file avance. Ne lève jamais : le cours
 * terminé ne doit pas être marqué en échec à cause de la file.
 */
export async function afterCourseJob(
  userId: string,
  courseId: string,
  opts: QueueOptions = {},
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: course } = await admin
      .from("courses")
      .select("status, error")
      .eq("id", courseId)
      .eq("user_id", userId)
      .maybeSingle();
    if (course?.status === "failed") {
      const { data: lesson } = await admin
        .from("binder_lessons")
        .select("binder_id, title")
        .eq("course_id", courseId)
        .maybeSingle();
      if (lesson) {
        await admin
          .from("binders")
          .update({
            status: "paused",
            error: `« ${lesson.title} » s'est arrêtée : ${course.error ?? "erreur inconnue"}`,
          })
          .eq("id", lesson.binder_id)
          .eq("status", "running");
      }
    }
    await advanceBinders(userId, opts);
  } catch (error) {
    console.error("[murmure] file des classeurs", error);
  }
}
