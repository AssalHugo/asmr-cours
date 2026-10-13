"use server";

import { randomUUID } from "node:crypto";
import { runs } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAllowedEmail } from "@/lib/allowlist";
import { getAmbience, SYNTHETIC_AMBIENCE_ID } from "@/lib/ambiences";
import { isAmbienceInstalled } from "@/lib/audio/ambience-synth";
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
import { billingModels, getGlobalMonthlySpend, getMonthlySpend, getProfile } from "@/lib/data";
import { env } from "@/lib/env";
import { comboKey, estimateCourse } from "@/lib/estimate";
import { startJob } from "@/lib/jobs";
import { isActive, type CourseStatus } from "@/lib/pipeline/status";
import { mapLimit } from "@/lib/retry";
import { inspectSource, type SourceInfo } from "@/lib/source";
import { keys, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GLOBAL_BUDGET_MESSAGE } from "@/trigger/steps/context";

const SIGNED_OUT = fail("Ta session a expiré. Reconnecte-toi.");

export type PreparedSource = SourceInfo & { courseId: string; title: string };

function titleFromFile(name: string | undefined): string {
  const base = (name ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base.length > 0 ? base.slice(0, 120) : "Nouveau cours";
}

async function courseExists(courseId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  return data !== null;
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
    // Un texte corrigé puis renvoyé remplace le précédent dépôt, tant qu'aucun cours n'en est né.
    const courseId =
      input.courseId && !(await courseExists(input.courseId)) ? input.courseId : randomUUID();
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

  // Une lecture ratée ne vaut pas « aucun cours » : les limites refusent plutôt que de laisser passer.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [active, launches] = await Promise.all([
    admin
      .from("courses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("status", "in", "(ready,failed)"),
    // Journal des lancements : supprimer un cours ne rend pas un lancement du jour.
    admin
      .from("course_launches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", dayStart.toISOString()),
  ]);
  if (active.error || launches.error) return fail(CHECK_FAILED);
  if ((active.count ?? 0) > 0) return BUSY;
  if ((launches.count ?? 0) >= e.DAILY_COURSE_LIMIT) {
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

  const { models, mock } = billingModels();
  // Vérifié avant tout appel payant : sans son fichier, le cours échouerait au mix.
  if (!(await isAmbienceInstalled(storage(), input.ambience, mock))) {
    return fail(ambienceMissing(input.ambience), "ambience_missing");
  }

  const { data: measured } = await supabase
    .from("courses")
    .select("source_chars, duration_ms")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .eq("voice_id", input.voiceId)
    .eq("mode", input.mode)
    .limit(10);
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
  const budget = await budgetState(user);
  if (!budget) return fail(CHECK_FAILED);
  const decision = checkBudget({
    spentUsd: budget.spentUsd,
    estimateUsd: combo.totalUsd,
    budgetUsd: budget.budgetUsd,
    tier: input.tier,
    confirmed: input.confirmed,
  });
  if (!decision.ok) return fail(decision.message, decision.reason);
  if (budget.globalLeftUsd !== null && combo.totalUsd > budget.globalLeftUsd) {
    return fail(GLOBAL_BUDGET_MESSAGE, "over_budget");
  }

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
  // L'index unique « un cours actif par compte » tranche entre deux lancements simultanés.
  if (error) {
    return error.message.includes(ONE_ACTIVE_INDEX)
      ? BUSY
      : fail("Ce cours existe déjà ou n'a pas pu être créé.");
  }
  await admin.from("course_launches").insert({ user_id: user.id });

  return launch(user, input.courseId, {
    kind: "generate-course",
    payload: { courseId: input.courseId, userId: user.id, titleIsDefault: input.titleIsDefault },
  });
}

const ONE_ACTIVE_INDEX = "courses_one_active_per_user";
const CHECK_FAILED = "Les limites n'ont pas pu être vérifiées. Réessaie dans un instant.";
const BUSY = fail(
  "Un cours est déjà en préparation. Attends qu'il soit prêt pour en lancer un autre.",
  "busy",
);
const OVER_BUDGET = fail("Le budget du mois est atteint.", "over_budget");

const ambienceMissing = (id: string) =>
  `L'ambiance « ${getAmbience(id)?.label ?? id} » n'est pas encore installée. Choisis « Bruit rose ».`;

/** Budget et dépense du mois, ou `null` si la lecture échoue (les appelants refusent alors). */
async function budgetState(
  user: SessionUser,
): Promise<{ budgetUsd: number; spentUsd: number; globalLeftUsd: number | null } | null> {
  try {
    const cap = env().GLOBAL_MONTHLY_BUDGET_USD;
    const [profile, spentUsd, globalSpent] = await Promise.all([
      getProfile(user.id),
      getMonthlySpend(),
      cap === undefined ? 0 : getGlobalMonthlySpend(),
    ]);
    return {
      budgetUsd: Number(profile.monthly_budget_usd),
      spentUsd,
      globalLeftUsd: cap === undefined ? null : Math.max(0, cap - globalSpent),
    };
  } catch {
    return null;
  }
}

/** Refus d'une action payante quand le budget du mois (personnel ou global) est épuisé. */
async function budgetRefusal(user: SessionUser): Promise<ReturnType<typeof fail> | null> {
  if (billingModels().mock) return null;
  const budget = await budgetState(user);
  if (!budget) return fail(CHECK_FAILED);
  if (budget.spentUsd >= budget.budgetUsd) return OVER_BUDGET;
  if (budget.globalLeftUsd !== null && budget.globalLeftUsd <= 0) {
    return fail(GLOBAL_BUDGET_MESSAGE, "over_budget");
  }
  return null;
}

type CourseJob = Parameters<typeof startJob>[0];

/**
 * Change le statut d'un cours seulement s'il est encore dans l'état attendu : deux clics
 * simultanés ne lancent qu'une tâche. L'index unique refuse un second cours actif.
 */
async function transition(
  user: SessionUser,
  courseId: string,
  from: CourseStatus,
  patch: { status: CourseStatus; progress: number },
): Promise<ReturnType<typeof fail> | null> {
  const { data, error } = await createAdminClient()
    .from("courses")
    .update({ ...patch, error: null })
    .eq("id", courseId)
    .eq("user_id", user.id)
    .eq("status", from)
    .select("id");
  if (error) return error.message.includes(ONE_ACTIVE_INDEX) ? BUSY : fail(CHECK_FAILED);
  return data.length > 0 ? null : fail("Ce cours a changé entre-temps. Recharge la page.");
}

async function launch(
  user: SessionUser,
  courseId: string,
  job: CourseJob,
  /** Statut à rétablir si la tâche ne démarre pas : un cours prêt le reste. */
  onFailure: "failed" | "ready" = "failed",
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
      .update(
        onFailure === "ready"
          ? { status: "ready", progress: 100, error: null }
          : { status: "failed", error: message },
      )
      .eq("id", courseId)
      .eq("user_id", user.id);
    return fail(message);
  }
  revalidatePath("/library");
  return { ok: true, data: { courseId } };
}

/**
 * Cours de l'utilisatrice, avec ses colonnes internes : lu avec la clé secrète, donc
 * toujours filtré par `user_id` (un cours reçu en partage n'est pas « à elle »).
 */
async function ownCourse(user: SessionUser, courseId: string) {
  if (!z.uuid().safeParse(courseId).success) return null;
  const { data } = await createAdminClient()
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

/** « Reprendre » un cours en échec : le pipeline saute ce qui est déjà fait. */
export async function resumeCourse(
  courseId: string,
): Promise<ActionResult<{ courseId: string; notice?: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (course.status !== "failed") return fail("Ce cours n'a pas besoin d'être repris.");
  const refusal = await budgetRefusal(user);
  if (refusal) return refusal;

  // Une ambiance désinstallée bloquerait la reprise pour de bon : repli sur le bruit rose,
  // toujours disponible. L'ambiance se change ensuite depuis la page du cours.
  let notice: string | undefined;
  if (!(await isAmbienceInstalled(storage(), course.ambience, billingModels().mock))) {
    await createAdminClient()
      .from("courses")
      .update({
        ambience: SYNTHETIC_AMBIENCE_ID,
        ambience_gain_db: getAmbience(SYNTHETIC_AMBIENCE_ID)?.defaultGainDb ?? -6,
      })
      .eq("id", courseId)
      .eq("user_id", user.id);
    notice = `L'ambiance « ${getAmbience(course.ambience)?.label ?? course.ambience} » n'est pas installée : le cours reprend avec « Bruit rose ».`;
  }

  const refused = await transition(user, courseId, "failed", { status: "queued", progress: 0 });
  if (refused) return refused;
  const launched = await launch(user, courseId, {
    kind: "generate-course",
    payload: { courseId, userId: user.id, titleIsDefault: false },
  });
  return launched.ok ? { ok: true, data: { courseId, notice } } : launched;
}

/** Régénère une section : seuls les chunks modifiés sont payés. */
export async function regenerateSection(
  courseId: string,
  sectionId: string,
): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!z.uuid().safeParse(sectionId).success) return fail("Cette section n'existe plus.");
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (course.status !== "ready") return fail("Attends que le cours soit prêt.");
  const refusal = await budgetRefusal(user);
  if (refusal) return refusal;

  const refused = await transition(user, courseId, "ready", { status: "rewriting", progress: 12 });
  if (refused) return refused;
  return launch(
    user,
    courseId,
    { kind: "regenerate-section", payload: { courseId, userId: user.id, sectionId } },
    "ready",
  );
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
  if (!(await isAmbienceInstalled(storage(), parsed.data.ambience, billingModels().mock))) {
    return fail(ambienceMissing(parsed.data.ambience), "ambience_missing");
  }

  const refused = await transition(user, course.id, "ready", {
    status: "assembling",
    progress: 85,
  });
  if (refused) return refused;
  return launch(
    user,
    course.id,
    {
      kind: "remix",
      payload: {
        courseId: course.id,
        userId: user.id,
        ambience: parsed.data.ambience,
        ambienceGainDb: parsed.data.ambienceGainDb,
      },
    },
    "ready",
  );
}

/** Hashes des chunks d'un cours que plus aucun autre cours n'utilise. */
async function orphanedChunkHashes(courseId: string): Promise<string[]> {
  const admin = createAdminClient();
  const hashes = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("chunks")
      .select("hash")
      .eq("course_id", courseId)
      .order("idx")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data) hashes.add(row.hash);
    if (data.length < 1000) break;
  }
  const all = [...hashes];
  for (let i = 0; i < all.length; i += 100) {
    const { data, error } = await admin
      .from("chunks")
      .select("hash")
      .in("hash", all.slice(i, i + 100))
      .neq("course_id", courseId);
    if (error) throw new Error(error.message);
    for (const row of data) hashes.delete(row.hash);
  }
  return [...hashes];
}

/** Supprime un cours : rendus, sources et audio du cache TTS qu'il était seul à utiliser. */
export async function deleteCourse(courseId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const course = await ownCourse(user, courseId);
  if (!course) return fail("Ce cours n'existe plus.");

  if (course.trigger_run_id && isActive(course.status) && env().JOBS_MODE === "trigger") {
    await runs.cancel(course.trigger_run_id).catch(() => undefined);
  }
  // Relevé avant la suppression en base, qui emporte les chunks.
  const orphans = await orphanedChunkHashes(courseId).catch(() => []);
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
  // Au mieux : un fichier resté dans le cache ne gêne personne.
  await mapLimit(orphans, 8, (hash) => store.delete(keys.ttsCache(hash))).catch(() => undefined);
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
