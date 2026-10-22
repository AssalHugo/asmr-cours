import "server-only";
import { runs } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAmbience } from "@/lib/ambiences";
import type { SessionUser } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/course-input";
import { getGlobalMonthlySpend, getMonthlySpend, getProfile } from "@/lib/data";
import { billingModels } from "@/lib/billing";
import { env } from "@/lib/env";
import { startJob } from "@/lib/jobs";
import { isActive, type CourseStatus } from "@/lib/pipeline/status";
import { mapLimit } from "@/lib/retry";
import { keys, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { GLOBAL_BUDGET_MESSAGE } from "@/trigger/steps/context";

/** Contrôles et lancement partagés par les actions de cours et de classeurs. */

export const ONE_ACTIVE_INDEX = "courses_one_active_per_user";
export const CHECK_FAILED = "Les limites n'ont pas pu être vérifiées. Réessaie dans un instant.";
export const BUSY = fail(
  "Un cours est déjà en préparation. Attends qu'il soit prêt pour en lancer un autre.",
  "busy",
);
export const OVER_BUDGET = fail("Le budget du mois est atteint.", "over_budget");

export const ambienceMissing = (id: string) =>
  `L'ambiance « ${getAmbience(id)?.label ?? id} » n'est pas encore installée. Choisis « Bruit rose ».`;

/** Budget et dépense du mois, ou `null` si la lecture échoue (les appelants refusent alors). */
export async function budgetState(
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
export async function budgetRefusal(user: SessionUser): Promise<ReturnType<typeof fail> | null> {
  if (billingModels().mock) return null;
  const budget = await budgetState(user);
  if (!budget) return fail(CHECK_FAILED);
  if (budget.spentUsd >= budget.budgetUsd) return OVER_BUDGET;
  if (budget.globalLeftUsd !== null && budget.globalLeftUsd <= 0) {
    return fail(GLOBAL_BUDGET_MESSAGE, "over_budget");
  }
  return null;
}

export type CourseJob = Parameters<typeof startJob>[0];

/**
 * Change le statut d'un cours seulement s'il est encore dans l'état attendu : deux clics
 * simultanés ne lancent qu'une tâche. L'index unique refuse un second cours actif.
 */
export async function transition(
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

export async function launch(
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
export async function ownCourse(user: SessionUser, courseId: string) {
  if (!z.uuid().safeParse(courseId).success) return null;
  const { data } = await createAdminClient()
    .from("courses")
    .select("*")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

/** Hashes des chunks d'un cours que plus aucun autre cours n'utilise. */
export async function orphanedChunkHashes(courseId: string): Promise<string[]> {
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

type OwnCourse = Database["public"]["Tables"]["courses"]["Row"];

/** Supprime un cours et ses fichiers. Renvoie faux si la ligne n'a pas pu être effacée. */
export async function removeCourse(user: SessionUser, course: OwnCourse): Promise<boolean> {
  const courseId = course.id;
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
  if (error) return false;
  // Au mieux : un fichier resté dans le cache ne gêne personne.
  await mapLimit(orphans, 8, (hash) => store.delete(keys.ttsCache(hash))).catch(() => undefined);
  return true;
}
