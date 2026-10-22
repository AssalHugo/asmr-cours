"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resumeCourse } from "@/app/(app)/actions";
import { isAmbienceInstalled } from "@/lib/audio/ambience-synth";
import { getUser, type SessionUser } from "@/lib/auth";
import { detectLessons, rangeChars, samplePages, type LessonDraft } from "@/lib/binder/detect";
import { partitionError, planLessons, type PlannedLesson } from "@/lib/binder/lessons";
import { analyzePdf, extractPages } from "@/lib/binder/pdf";
import { advanceBinders } from "@/lib/binder/queue";
import { checkBudget } from "@/lib/budget";
import {
  BinderSampleInput,
  CourseSettings,
  CreateBinderInput,
  fail,
  StartBinderInput,
  type ActionResult,
} from "@/lib/course-input";
import {
  ambienceMissing,
  budgetState,
  BUSY,
  CHECK_FAILED,
  launch,
  ONE_ACTIVE_INDEX,
  ownCourse,
  removeCourse,
} from "@/lib/course-launch";
import { billingModels } from "@/lib/data";
import { env } from "@/lib/env";
import { comboKey, estimateCourse, type TtsTier } from "@/lib/estimate";
import { SAMPLE_MAX_CHARS } from "@/lib/pipeline/sections";
import { isActive } from "@/lib/pipeline/status";
import { keys, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { GLOBAL_BUDGET_MESSAGE } from "@/trigger/steps/context";

const SIGNED_OUT = fail("Ta session a expiré. Reconnecte-toi.");
const BINDER_GONE = fail("Ce classeur n'existe plus.");
const NOT_DRAFT = fail("Les leçons de ce classeur sont déjà en file. Recharge la page.");
/** Texte visé pour l'échantillon, avant la coupe à `SAMPLE_MAX_CHARS` par le pipeline. */
const SAMPLE_SOURCE = { targetChars: 6000, maxPages: 4 };
const SOURCE_FILE = "source.pdf";

type Tables = Database["public"]["Tables"];
type BinderRow = Tables["binders"]["Row"];
type LessonRow = Tables["binder_lessons"]["Row"];

const limits = () => ({ maxPages: env().MAX_PDF_PAGES, maxChars: env().MAX_SOURCE_CHARS });
const shape = (binder: BinderRow) => ({
  pages: binder.pages,
  pageChars: binder.page_chars,
  scanned: binder.scanned,
});

function titleFromFile(name: string | undefined): string {
  const base = (name ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base.length > 0 ? base.slice(0, 120) : "Classeur";
}

async function ownBinder(user: SessionUser, binderId: string): Promise<BinderRow | null> {
  if (!z.uuid().safeParse(binderId).success) return null;
  const { data } = await createAdminClient()
    .from("binders")
    .select("*")
    .eq("id", binderId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

async function binderLessons(binderId: string): Promise<LessonRow[]> {
  const { data, error } = await createAdminClient()
    .from("binder_lessons")
    .select("*")
    .eq("binder_id", binderId)
    .order("idx");
  if (error) throw new Error(error.message);
  return data;
}

const toDrafts = (rows: LessonRow[]): LessonDraft[] =>
  rows.map((r) => ({ title: r.title, firstPage: r.first_page, selected: r.selected }));

/** Leçons envoyées par l'écran, contrôlées contre le document. */
function checkLessons(
  binder: BinderRow,
  lessons: LessonDraft[],
): { ok: true; planned: PlannedLesson[] } | { ok: false; message: string } {
  const broken = partitionError(lessons, binder.pages);
  if (broken) return { ok: false, message: broken };
  return { ok: true, planned: planLessons(lessons, shape(binder), limits()) };
}

/** Voix et ambiance encore disponibles : contrôlées avant tout appel payant. */
async function checkSettings(settings: CourseSettings): Promise<string | null> {
  const { data: voice } = await (
    await createClient()
  )
    .from("voices")
    .select("id, env")
    .eq("id", settings.voiceId)
    .maybeSingle();
  if (!voice || voice.env !== env().APP_ENV) {
    return "Cette voix n'est plus disponible. Choisis-en une autre.";
  }
  if (!(await isAmbienceInstalled(storage(), settings.ambience, billingModels().mock))) {
    return ambienceMissing(settings.ambience);
  }
  return null;
}

async function estimateUsd(
  user: SessionUser,
  settings: CourseSettings,
  lesson: { chars: number; pages: number },
  tier: TtsTier = settings.tier,
): Promise<number> {
  const { data: measured } = await (
    await createClient()
  )
    .from("courses")
    .select("source_chars, duration_ms")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .eq("voice_id", settings.voiceId)
    .eq("mode", settings.mode)
    .limit(10);
  const { models, mock } = billingModels();
  const estimate = estimateCourse({
    sourceChars: lesson.chars,
    sourceKind: "pdf",
    pages: lesson.pages,
    mode: settings.mode,
    quiz: settings.quiz,
    measured: (measured ?? []).flatMap((m) =>
      m.source_chars && m.duration_ms
        ? [{ sourceChars: m.source_chars, durationMs: m.duration_ms }]
        : [],
    ),
    models,
    at: new Date(),
    mock,
  });
  return estimate.combos[comboKey(tier, settings.quality)].totalUsd;
}

/**
 * Découpe le PDF du classeur, lu une seule fois, et dépose chaque plage sous le préfixe du
 * futur cours : `deleteCourse` l'emportera avec lui.
 */
async function uploadParts(
  user: SessionUser,
  binder: BinderRow,
  parts: { courseId: string; range: { firstPage: number; lastPage: number } }[],
): Promise<string[]> {
  if (parts.length === 0) return [];
  const store = storage();
  const pdfData = await store.get(binder.source_key);
  const uploaded = parts.map((p) => keys.upload(user.id, p.courseId, SOURCE_FILE));
  await extractPages(
    pdfData,
    parts.map((p) => p.range),
    async (file, index) => {
      const key = uploaded[index];
      if (file && key) await store.put(key, file, "application/pdf");
    },
  );
  return uploaded;
}

type LessonExtra = { state?: "idle" | "queued"; planned_course_id?: string; source_key?: string };

/**
 * Remplace les leçons d'un classeur en préparation par celles modifiées à l'écran, d'un seul
 * tenant (fonction SQL) : un refus laisse les anciennes en place.
 */
async function saveDraftLessons(
  binderId: string,
  planned: PlannedLesson[],
  extra: (lesson: PlannedLesson) => LessonExtra = () => ({}),
): Promise<boolean> {
  const { error } = await createAdminClient().rpc("replace_binder_lessons", {
    p_binder_id: binderId,
    p_lessons: planned.map((lesson) => ({
      idx: lesson.idx,
      title: lesson.title,
      first_page: lesson.firstPage,
      last_page: lesson.lastPage,
      chars: lesson.chars,
      selected: lesson.selected,
      ...extra(lesson),
    })),
  });
  return !error;
}

/** Un gros PDF déposé devient un classeur : ses leçons sont trouvées sans IA, donc sans frais. */
export async function createBinder(raw: unknown): Promise<ActionResult<{ binderId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = CreateBinderInput.safeParse(raw);
  if (!parsed.success) return fail("Dépôt invalide.");
  const { binderId, key, fileName } = parsed.data;
  if (
    !key.startsWith(keys.uploadPrefix(user.id, binderId)) ||
    key.includes("..") ||
    !key.endsWith(".pdf")
  ) {
    return fail("Ce fichier n'appartient pas à ce dépôt.");
  }
  if (await ownBinder(user, binderId)) return { ok: true, data: { binderId } };

  const admin = createAdminClient();
  const [{ data: course }, { data: other }] = await Promise.all([
    admin.from("courses").select("id").eq("id", binderId).maybeSingle(),
    admin.from("binders").select("id").eq("id", binderId).maybeSingle(),
  ]);
  if (course || other) return fail("Ce dépôt a déjà servi. Dépose le fichier de nouveau.");

  const e = env();
  const store = storage();
  const info = await store.head(key);
  if (!info) return fail("Le fichier n'est pas arrivé. Dépose-le de nouveau.");
  if (info.bytes > e.MAX_BINDER_MB * 1024 * 1024) {
    return fail(`Fichier trop lourd : ${e.MAX_BINDER_MB} Mo maximum.`);
  }
  let analysis;
  try {
    analysis = await analyzePdf(await store.get(key));
  } catch {
    return fail("Ce PDF est illisible ou protégé. Essaie de l'exporter de nouveau.");
  }
  if (analysis.pages > e.MAX_BINDER_PAGES) {
    return fail(`Ce PDF fait ${analysis.pages} pages : la limite est de ${e.MAX_BINDER_PAGES}.`);
  }

  const detection = detectLessons({
    pageTexts: analysis.pageTexts,
    pageChars: analysis.pageChars,
    outline: analysis.outline,
    limits: limits(),
  });
  const { error } = await admin.from("binders").insert({
    id: binderId,
    user_id: user.id,
    title: titleFromFile(fileName),
    source_key: key,
    pages: analysis.pages,
    page_chars: analysis.pageChars,
    scanned: analysis.scanned,
    detection: detection.method,
  });
  if (error) return fail("Le classeur n'a pas pu être créé. Réessaie.");
  const planned = planLessons(detection.lessons, analysis, limits());
  if (!(await saveDraftLessons(binderId, planned))) {
    await admin.from("binders").delete().eq("id", binderId);
    return fail("Le classeur n'a pas pu être créé. Réessaie.");
  }
  revalidatePath("/library");
  return { ok: true, data: { binderId } };
}

/**
 * Échantillon : quelques minutes du début d'une leçon, avec la voix et l'ambiance choisies,
 * en Express pour l'écouter tout de suite. Quelques centimes, avant d'engager tout le classeur.
 */
export async function createBinderSample(
  raw: unknown,
): Promise<ActionResult<{ courseId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = BinderSampleInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Réglages invalides.");
  const { binderId, lessons, lessonIndex, settings } = parsed.data;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  if (binder.status !== "draft") return NOT_DRAFT;
  const checked = checkLessons(binder, lessons);
  if (!checked.ok) return fail(checked.message);
  const lesson = checked.planned[lessonIndex];
  if (!lesson?.range) return fail("Cette leçon est vide : choisis-en une autre.");
  const refused = await checkSettings(settings);
  if (refused) return fail(refused);

  const range = samplePages(lesson.range, binder.page_chars, binder.scanned, SAMPLE_SOURCE);
  const sampleChars = Math.min(
    SAMPLE_MAX_CHARS,
    rangeChars(range.firstPage, range.lastPage, binder.page_chars),
  );
  const pages = range.lastPage - range.firstPage + 1;
  const cost = await estimateUsd(user, settings, { chars: sampleChars, pages }, "express");
  const budget = await budgetState(user);
  if (!budget) return fail(CHECK_FAILED);
  // Quelques centimes : seul le plafond compte, pas la confirmation des 80 %.
  const decision = checkBudget({
    spentUsd: budget.spentUsd,
    estimateUsd: cost,
    budgetUsd: budget.budgetUsd,
    tier: "eco",
    confirmed: true,
  });
  if (!decision.ok) return fail(decision.message, decision.reason);
  if (budget.globalLeftUsd !== null && cost > budget.globalLeftUsd) {
    return fail(GLOBAL_BUDGET_MESSAGE, "over_budget");
  }

  // L'échantillon précédent laisse la place : un seul par classeur.
  if (binder.sample_course_id) {
    const previous = await ownCourse(user, binder.sample_course_id);
    if (previous && isActive(previous.status)) return BUSY;
    if (previous) await removeCourse(user, previous);
  }
  if (!(await saveDraftLessons(binder.id, checked.planned))) return fail(CHECK_FAILED);

  const courseId = randomUUID();
  let sourceKey: string | undefined;
  try {
    [sourceKey] = await uploadParts(user, binder, [{ courseId, range }]);
  } catch {
    return fail("Les pages de l'échantillon n'ont pas pu être découpées. Réessaie.");
  }
  if (!sourceKey) return fail(CHECK_FAILED);
  const admin = createAdminClient();
  const { error } = await admin.from("courses").insert({
    id: courseId,
    user_id: user.id,
    title: `Échantillon · ${lesson.title}`.slice(0, 200),
    source_kind: "pdf",
    source_keys: [sourceKey],
    source_chars: binder.scanned ? null : sampleChars,
    mode: settings.mode,
    tier: "express",
    quality: settings.quality,
    voice_id: settings.voiceId,
    ambience: settings.ambience,
    ambience_gain_db: settings.ambienceGainDb,
    address_form: settings.addressForm,
    quiz: settings.quiz,
    is_sample: true,
    est_cost_usd: Number(cost.toFixed(4)),
  });
  if (error) {
    await storage()
      .deletePrefix(keys.uploadPrefix(user.id, courseId))
      .catch(() => undefined);
    return error.message.includes(ONE_ACTIVE_INDEX)
      ? BUSY
      : fail("L'échantillon n'a pas pu être créé.");
  }
  await admin.from("binders").update({ sample_course_id: courseId }).eq("id", binder.id);
  const launched = await launch(user, courseId, {
    kind: "generate-course",
    payload: { courseId, userId: user.id, titleIsDefault: false },
  });
  revalidatePath(`/binders/${binder.id}`);
  return launched;
}

/** Dossier de la bibliothèque qui recevra les leçons : celui qui porte déjà ce nom, ou un nouveau. */
async function binderFolder(user: SessionUser, title: string): Promise<string | null> {
  const admin = createAdminClient();
  const name = title.trim().slice(0, 60) || "Classeur";
  const { data: existing } = await admin
    .from("folders")
    .select("id")
    .eq("user_id", user.id)
    .ilike("name", name.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await admin
    .from("folders")
    .insert({ user_id: user.id, name })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

/**
 * Met en file les leçons cochées : leurs pages sont découpées, puis la première démarre. Les
 * suivantes partent une à une, chacune après un contrôle du budget.
 */
export async function startBinder(
  raw: unknown,
): Promise<ActionResult<{ courseId: string | null; notice?: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = StartBinderInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Réglages invalides.");
  const { binderId, lessons, settings, confirmed } = parsed.data;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  if (binder.status !== "draft") return NOT_DRAFT;
  const checked = checkLessons(binder, lessons);
  if (!checked.ok) return fail(checked.message);
  const chosen = checked.planned.filter((l) => l.selected);
  const [first] = chosen;
  if (!first) return fail("Coche au moins une leçon.");
  const blocked = chosen.find((l) => l.problem !== null);
  if (blocked) return fail(`« ${blocked.title} » : ${blocked.problem}`);
  const refused = await checkSettings(settings);
  if (refused) return fail(refused);

  // Le budget est contrôlé sur la première leçon ; les suivantes le seront à leur tour.
  const cost = await estimateUsd(user, settings, first);
  const budget = await budgetState(user);
  if (!budget) return fail(CHECK_FAILED);
  const decision = checkBudget({
    spentUsd: budget.spentUsd,
    estimateUsd: cost,
    budgetUsd: budget.budgetUsd,
    tier: settings.tier,
    confirmed,
  });
  if (!decision.ok) return fail(decision.message, decision.reason);
  if (budget.globalLeftUsd !== null && cost > budget.globalLeftUsd) {
    return fail(GLOBAL_BUDGET_MESSAGE, "over_budget");
  }

  // La file entière compte pour un lancement dans la limite du jour : c'est un seul choix.
  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await admin
    .from("course_launches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", dayStart.toISOString());
  if (countError) return fail(CHECK_FAILED);
  if ((count ?? 0) >= env().DAILY_COURSE_LIMIT) {
    return fail(
      `Tu as atteint la limite de ${env().DAILY_COURSE_LIMIT} lancements par jour. À demain !`,
      "daily_limit",
    );
  }

  const planned = new Map(chosen.map((l) => [l.idx, randomUUID()]));
  let sourceKeys: string[];
  try {
    sourceKeys = await uploadParts(
      user,
      binder,
      chosen.flatMap((l) => {
        const courseId = planned.get(l.idx);
        return l.range && courseId ? [{ courseId, range: l.range }] : [];
      }),
    );
  } catch {
    return fail("Le document n'a pas pu être découpé. Réessaie.");
  }
  const keyOf = new Map(chosen.map((l, i) => [l.idx, sourceKeys[i]]));
  const saved = await saveDraftLessons(binder.id, checked.planned, (lesson) => {
    const courseId = planned.get(lesson.idx);
    return courseId
      ? { state: "queued", planned_course_id: courseId, source_key: keyOf.get(lesson.idx) }
      : { state: "idle" };
  });
  if (!saved) return fail(CHECK_FAILED);

  const folderId = await binderFolder(user, binder.title);
  const { data: started } = await admin
    .from("binders")
    .update({ status: "running", settings, folder_id: folderId, error: null })
    .eq("id", binder.id)
    .eq("status", "draft")
    .select("id");
  if (!started?.length) return NOT_DRAFT;
  await admin.from("course_launches").insert({ user_id: user.id });

  const result = await advanceBinders(user.id);
  revalidatePath("/library");
  revalidatePath(`/binders/${binder.id}`);
  if (result.pausedMessage) return fail(result.pausedMessage);
  return {
    ok: true,
    data: {
      courseId: result.launchedCourseId,
      notice: result.launchedCourseId
        ? undefined
        : "Un cours est déjà en préparation : la première leçon partira juste après.",
    },
  };
}

/** Met la file en pause : la leçon en cours se termine, la suivante attend. */
export async function pauseBinder(binderId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  const { error } = await createAdminClient()
    .from("binders")
    .update({ status: "paused", error: null })
    .eq("id", binder.id)
    .eq("status", "running");
  if (error) return fail("La pause n'a pas pu être prise. Réessaie.");
  revalidatePath(`/binders/${binder.id}`);
  return { ok: true };
}

/**
 * Relance la file, éventuellement avec d'autres réglages pour les leçons suivantes. Une leçon
 * arrêtée en route est reprise d'abord : ce qu'elle a déjà produit est conservé.
 */
export async function resumeBinder(
  binderId: string,
  rawSettings?: unknown,
): Promise<ActionResult<{ notice?: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  if (binder.status !== "paused") return fail("Cette file n'est pas en pause. Recharge la page.");
  const admin = createAdminClient();

  let settings = binder.settings;
  if (rawSettings !== undefined) {
    const parsed = CourseSettings.safeParse(rawSettings);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Réglages invalides.");
    const refused = await checkSettings(parsed.data);
    if (refused) return fail(refused);
    settings = parsed.data;
  }
  const { data: resumed } = await admin
    .from("binders")
    .update({ status: "running", error: null, settings })
    .eq("id", binder.id)
    .eq("status", "paused")
    .select("id");
  if (!resumed?.length) return fail("Cette file a changé entre-temps. Recharge la page.");
  revalidatePath(`/binders/${binder.id}`);

  const rows = await binderLessons(binder.id);
  for (const lesson of rows.filter((l) => l.state === "launched" && l.course_id)) {
    const course = lesson.course_id ? await ownCourse(user, lesson.course_id) : null;
    if (course?.status !== "failed") continue;
    const result = await resumeCourse(course.id);
    if (result.ok) return { ok: true, data: { notice: result.data.notice } };
    await admin
      .from("binders")
      .update({ status: "paused", error: result.message })
      .eq("id", binder.id);
    return result;
  }

  const result = await advanceBinders(user.id);
  if (result.pausedMessage) return fail(result.pausedMessage);
  return {
    ok: true,
    data: {
      notice: result.launchedCourseId
        ? undefined
        : "Un cours est en préparation : la file reprendra dès qu'il sera prêt.",
    },
  };
}

/** Retire une leçon de la file, tant qu'elle n'a pas démarré. */
export async function dequeueLesson(binderId: string, lessonId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  if (!z.uuid().safeParse(lessonId).success) return fail("Cette leçon n'existe plus.");
  const { data } = await createAdminClient()
    .from("binder_lessons")
    .update({ state: "idle", source_key: null })
    .eq("id", lessonId)
    .eq("binder_id", binder.id)
    .eq("state", "queued")
    .select("planned_course_id");
  const [lesson] = data ?? [];
  if (!lesson) return fail("Cette leçon a déjà démarré.");
  await storage()
    .deletePrefix(keys.uploadPrefix(user.id, lesson.planned_course_id))
    .catch(() => undefined);
  revalidatePath(`/binders/${binder.id}`);
  return { ok: true };
}

/** Ajoute une leçon à la file d'un classeur déjà lancé ; elle part après les autres. */
export async function enqueueLesson(
  binderId: string,
  lessonId: string,
): Promise<ActionResult<{ notice?: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  if (binder.status === "draft") return fail("Coche cette leçon, puis lance la file.");
  const rows = await binderLessons(binder.id);
  const row = rows.find((l) => l.id === lessonId);
  if (!row || row.state !== "idle") return fail("Cette leçon est déjà dans la file.");
  const lesson = planLessons(toDrafts(rows), shape(binder), limits())[rows.indexOf(row)];
  if (!lesson?.range || lesson.problem) return fail(lesson?.problem ?? "Cette leçon est vide.");

  const courseId = randomUUID();
  let sourceKey: string | undefined;
  try {
    [sourceKey] = await uploadParts(user, binder, [{ courseId, range: lesson.range }]);
  } catch {
    return fail("Les pages de cette leçon n'ont pas pu être découpées. Réessaie.");
  }
  const admin = createAdminClient();
  // Elle prend son rang dans le document parmi les leçons qui attendent.
  const { data: queued } = await admin
    .from("binder_lessons")
    .update({
      state: "queued",
      selected: true,
      planned_course_id: courseId,
      source_key: sourceKey ?? null,
    })
    .eq("id", row.id)
    .eq("state", "idle")
    .select("id");
  if (!queued?.length) return fail("Cette leçon est déjà dans la file.");
  if (binder.status === "done") {
    await admin
      .from("binders")
      .update({ status: "running", error: null })
      .eq("id", binder.id)
      .eq("status", "done");
  }
  revalidatePath(`/binders/${binder.id}`);
  if (binder.status === "paused") {
    return { ok: true, data: { notice: "Ajoutée. La file est en pause : relance-la." } };
  }
  const result = await advanceBinders(user.id);
  if (result.pausedMessage) return fail(result.pausedMessage);
  return { ok: true, data: {} };
}

/** Supprime le classeur, son PDF et son échantillon. Les leçons déjà générées restent. */
export async function deleteBinder(binderId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const binder = await ownBinder(user, binderId);
  if (!binder) return BINDER_GONE;
  const rows = await binderLessons(binder.id);
  if (binder.sample_course_id) {
    const sample = await ownCourse(user, binder.sample_course_id);
    if (sample) await removeCourse(user, sample);
  }
  const store = storage();
  await Promise.all([
    store.deletePrefix(keys.uploadPrefix(user.id, binder.id)),
    ...rows
      .filter((l) => l.course_id === null)
      .map((l) => store.deletePrefix(keys.uploadPrefix(user.id, l.planned_course_id))),
  ]).catch(() => undefined);
  const { error } = await createAdminClient()
    .from("binders")
    .delete()
    .eq("id", binder.id)
    .eq("user_id", user.id);
  if (error) return fail("La suppression a échoué. Réessaie.");
  revalidatePath("/library");
  return { ok: true };
}
