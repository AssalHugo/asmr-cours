"use server";

import { randomUUID } from "node:crypto";
import { runs } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAllowedEmail } from "@/lib/allowlist";
import { getUser, type SessionUser } from "@/lib/auth";
import { checkBudget } from "@/lib/budget";
import {
  CreateCourseInput,
  fail,
  RemixInput,
  ShareInput,
  SourceInput,
  type ActionResult,
} from "@/lib/course-input";
import { billingModels, getMonthlySpend, getProfile } from "@/lib/data";
import { env } from "@/lib/env";
import { comboKey, estimateCourse } from "@/lib/estimate";
import { startJob } from "@/lib/jobs";
import { isActive } from "@/lib/pipeline/status";
import { inspectSource, type SourceInfo } from "@/lib/source";
import { keys, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SIGNED_OUT = fail("Ta session a expiré. Reconnecte-toi.");

export type PreparedSource = SourceInfo & { courseId: string; title: string };

function titleFromFile(name: string | undefined): string {
  const base = (name ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base.length > 0 ? base.slice(0, 120) : "Nouveau cours";
}

/** Étape 1 → 2 : contrôle la source déposée et mesure sa taille pour l'estimation. */
export async function prepareSource(raw: unknown): Promise<ActionResult<PreparedSource>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = SourceInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Source invalide.");
  const input = parsed.data;

  if (input.kind === "text") {
    if (input.text.length > env().MAX_SOURCE_CHARS) {
      return fail(`Ce texte dépasse ${env().MAX_SOURCE_CHARS.toLocaleString("fr-FR")} caractères.`);
    }
    const courseId = randomUUID();
    const key = keys.upload(user.id, courseId, "source.txt");
    await storage().put(key, Buffer.from(input.text, "utf8"), "text/plain; charset=utf-8");
    const firstLine = input.text.split("\n").find((l) => l.trim().length > 0) ?? "";
    return {
      ok: true,
      data: {
        courseId,
        title:
          firstLine
            .trim()
            .split(/\s+/)
            .slice(0, 6)
            .join(" ")
            .replace(/[.,;:]+$/, "")
            .slice(0, 60) || "Nouveau cours",
        kind: "text",
        keys: [key],
        sourceChars: input.text.length,
        pages: 0,
        approximate: false,
      },
    };
  }

  const check = await inspectSource(user.id, input.courseId, input.kind, input.keys);
  if (!check.ok) return fail(check.message);
  return {
    ok: true,
    data: {
      ...check.info,
      courseId: input.courseId,
      title: input.kind === "pdf" ? titleFromFile(input.fileName) : "Notes de cours",
    },
  };
}

/** Étape 3 : contrôles serveur (limites, budget), création du cours et lancement du pipeline. */
export async function createCourse(raw: unknown): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = CreateCourseInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Réglages invalides.");
  const input = parsed.data;
  const e = env();
  const supabase = await createClient();
  const admin = createAdminClient();

  const source = await inspectSource(user.id, input.courseId, input.source.kind, input.source.keys);
  if (!source.ok) return fail(source.message);

  const { data: mine } = await supabase
    .from("courses")
    .select("id, status, created_at")
    .eq("user_id", user.id);
  const courses = mine ?? [];
  if (courses.some((c) => isActive(c.status))) {
    return fail(
      "Un cours est déjà en préparation. Attends qu'il soit prêt pour en lancer un autre.",
      "busy",
    );
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  if (courses.filter((c) => new Date(c.created_at) >= dayStart).length >= e.DAILY_COURSE_LIMIT) {
    return fail(
      `Tu as atteint la limite de ${e.DAILY_COURSE_LIMIT} cours par jour. À demain !`,
      "daily_limit",
    );
  }

  const { data: voice } = await supabase
    .from("voices")
    .select("id, env")
    .eq("id", input.voiceId)
    .maybeSingle();
  if (!voice || voice.env !== e.APP_ENV)
    return fail("Cette voix n'est plus disponible. Choisis-en une autre.");

  const { data: measured } = await supabase
    .from("courses")
    .select("source_chars, duration_ms")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .eq("voice_id", input.voiceId)
    .eq("mode", input.mode)
    .limit(10);
  const { models, mock } = billingModels();
  const estimate = estimateCourse({
    sourceChars: source.info.sourceChars,
    sourceKind: source.info.kind,
    pages: source.info.pages,
    mode: input.mode,
    measured: (measured ?? []).flatMap((m) =>
      m.source_chars && m.duration_ms
        ? [{ sourceChars: m.source_chars, durationMs: m.duration_ms }]
        : [],
    ),
    models,
    at: new Date(),
    mock,
  });
  const combo = estimate.combos[comboKey(input.tier, input.quality)];

  // Garde-fou budget, côté serveur : non contournable depuis le navigateur.
  const [profile, spentUsd] = await Promise.all([getProfile(user.id), getMonthlySpend()]);
  const decision = checkBudget({
    spentUsd,
    estimateUsd: combo.totalUsd,
    budgetUsd: Number(profile.monthly_budget_usd),
    tier: input.tier,
    confirmed: input.confirmed,
  });
  if (!decision.ok) return fail(decision.message, decision.reason);

  const { error } = await admin.from("courses").insert({
    id: input.courseId,
    user_id: user.id,
    title: input.title,
    source_kind: source.info.kind,
    source_keys: source.info.keys,
    source_chars: source.info.approximate ? null : source.info.sourceChars,
    mode: input.mode,
    tier: input.tier,
    quality: input.quality,
    voice_id: input.voiceId,
    ambience: input.ambience,
    ambience_gain_db: input.ambienceGainDb,
    address_form: input.addressForm,
    est_cost_usd: Number(combo.totalUsd.toFixed(4)),
  });
  if (error) return fail("Ce cours existe déjà ou n'a pas pu être créé.");

  return launch(user, input.courseId, {
    kind: "generate-course",
    payload: { courseId: input.courseId, userId: user.id, titleIsDefault: input.titleIsDefault },
  });
}

type CourseJob = Parameters<typeof startJob>[0];

async function launch(
  user: SessionUser,
  courseId: string,
  job: CourseJob,
): Promise<ActionResult<{ courseId: string }>> {
  const admin = createAdminClient();
  try {
    const { runId } = await startJob(job);
    await admin
      .from("courses")
      .update({ trigger_run_id: runId })
      .eq("id", courseId)
      .eq("user_id", user.id);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "MissingEnvError"
        ? error.message
        : "Le lancement a échoué. Réessaie dans un instant.";
    await admin
      .from("courses")
      .update({ status: "failed", error: message })
      .eq("id", courseId)
      .eq("user_id", user.id);
    return fail(message);
  }
  revalidatePath("/library");
  return { ok: true, data: { courseId } };
}

/** La RLS laisse aussi lire les cours reçus en partage : le filtre `user_id` est indispensable. */
async function ownCourse(user: SessionUser, courseId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

/** « Reprendre » un cours en échec : le pipeline saute ce qui est déjà fait. */
export async function resumeCourse(courseId: string): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (course.status !== "failed") return fail("Ce cours n'a pas besoin d'être repris.");
  await createAdminClient()
    .from("courses")
    .update({ status: "queued", progress: 0, error: null })
    .eq("id", courseId)
    .eq("user_id", user.id);
  return launch(user, courseId, {
    kind: "generate-course",
    payload: { courseId, userId: user.id, titleIsDefault: false },
  });
}

/** Régénère une section : seuls les chunks modifiés sont payés. */
export async function regenerateSection(
  courseId: string,
  sectionId: string,
): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (course.status !== "ready") return fail("Attends que le cours soit prêt.");

  const [profile, spentUsd] = await Promise.all([getProfile(user.id), getMonthlySpend()]);
  if (spentUsd >= Number(profile.monthly_budget_usd) && !billingModels().mock) {
    return fail(
      "Le budget du mois est atteint : impossible de régénérer cette section.",
      "over_budget",
    );
  }
  await createAdminClient()
    .from("courses")
    .update({ status: "rewriting", progress: 12, error: null })
    .eq("id", courseId)
    .eq("user_id", user.id);
  return launch(user, courseId, {
    kind: "regenerate-section",
    payload: { courseId, userId: user.id, sectionId },
  });
}

/** Change l'ambiance du pré-mix : FFmpeg seul, aucun coût IA. */
export async function remixCourse(raw: unknown): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = RemixInput.safeParse(raw);
  if (!parsed.success) return fail("Ambiance invalide.");
  const course = await ownCourse(user, parsed.data.courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (course.status !== "ready") return fail("Attends que le cours soit prêt.");
  await createAdminClient()
    .from("courses")
    .update({ status: "assembling", progress: 85, error: null })
    .eq("id", course.id)
    .eq("user_id", user.id);
  return launch(user, course.id, {
    kind: "remix",
    payload: {
      courseId: course.id,
      userId: user.id,
      ambience: parsed.data.ambience,
      ambienceGainDb: parsed.data.ambienceGainDb,
    },
  });
}

/** Supprime un cours : rendus et sources. Le cache TTS global est conservé. */
export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");

  if (course.trigger_run_id && isActive(course.status) && env().JOBS_MODE === "trigger") {
    await runs.cancel(course.trigger_run_id).catch(() => undefined);
  }
  const store = storage();
  await Promise.all([
    store.deletePrefix(keys.coursePrefix(courseId)),
    store.deletePrefix(keys.uploadPrefix(user.id, courseId)),
  ]);
  const { error } = await createAdminClient()
    .from("courses")
    .delete()
    .eq("id", courseId)
    .eq("user_id", user.id);
  if (error) return fail("La suppression a échoué. Réessaie.");
  revalidatePath("/library");
  return { ok: true };
}

/** Partage un cours avec un autre compte, en lecture seule. */
export async function shareCourse(raw: unknown): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = ShareInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Adresse invalide.");
  const { courseId, email } = parsed.data;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (email === user.email.toLowerCase()) return fail("Ce cours est déjà dans ta bibliothèque.");
  if (!isAllowedEmail(email, env().ALLOWED_EMAILS)) {
    return fail("Cette adresse n'a pas accès à Murmure : elle ne pourrait pas se connecter.");
  }
  const { error } = await createAdminClient().from("course_shares").upsert(
    {
      course_id: courseId,
      owner_id: user.id,
      owner_email: user.email.toLowerCase(),
      recipient_email: email,
    },
    { onConflict: "course_id,recipient_email", ignoreDuplicates: true },
  );
  if (error) return fail("Le partage a échoué. Réessaie.");
  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

/** Retire un partage accordé par la propriétaire. */
export async function unshareCourse(raw: unknown): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = ShareInput.safeParse(raw);
  if (!parsed.success) return fail("Adresse invalide.");
  const { error } = await createAdminClient()
    .from("course_shares")
    .delete()
    .eq("course_id", parsed.data.courseId)
    .eq("owner_id", user.id)
    .eq("recipient_email", parsed.data.email);
  if (error) return fail("Le retrait a échoué. Réessaie.");
  revalidatePath(`/courses/${parsed.data.courseId}`);
  return { ok: true };
}

/** Côté destinataire : retire de sa bibliothèque un cours reçu en partage. */
export async function leaveSharedCourse(courseId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!z.uuid().safeParse(courseId).success) return fail("Ce cours n'existe plus.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("course_shares")
    .delete()
    .eq("course_id", courseId)
    .eq("recipient_email", user.email.toLowerCase());
  if (error) return fail("Le retrait a échoué. Réessaie.");
  await admin.from("playback_progress").delete().eq("course_id", courseId).eq("user_id", user.id);
  revalidatePath("/library");
  return { ok: true };
}
