import "server-only";
import { env } from "@/lib/env";
import type { EstimateModels } from "@/lib/estimate";
import { MOCK_MODEL } from "@/lib/pricing";
import { PREBUILT_VOICES, VOICE_PRESETS } from "@/lib/prompts/voice-presets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type Tables = Database["public"]["Tables"];
/**
 * Colonnes de `courses` lisibles avec la session. Les colonnes internes (clés de stockage,
 * identifiants de run et de batch) sont réservées au serveur : `select("*")` serait refusé.
 */
const COURSE_COLUMNS =
  "id, user_id, title, source_kind, source_chars, mode, tier, quality, voice_id, ambience, ambience_gain_db, address_form, status, progress, error, est_cost_usd, actual_cost_usd, duration_ms, created_at, updated_at" as const;
export type Course = Omit<
  Tables["courses"]["Row"],
  "source_keys" | "trigger_run_id" | "batch_job_id" | "batch_submitted_at" | "chunk_takes"
>;
export type Section = Tables["sections"]["Row"];
export type Voice = Tables["voices"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type Render = Tables["renders"]["Row"];

/**
 * Lectures de l'app : client de session, donc filtrées par la RLS. Elle laisse aussi passer les
 * cours partagés avec le compte : tout ce qui ne concerne que ses propres cours (débit mesuré,
 * dépenses) filtre en plus par `user_id`.
 */

export async function getProfile(userId: string): Promise<Profile> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (data) return data;
  // Compte créé avant le trigger d'inscription : on répare, sans jamais écraser un profil
  // existant (une lecture ratée ne doit pas remettre le budget à sa valeur par défaut).
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .upsert(
      { id: userId, monthly_budget_usd: env().MONTHLY_BUDGET_USD },
      { onConflict: "id", ignoreDuplicates: true },
    );
  const { data: found, error } = await admin.from("profiles").select("*").eq("id", userId).single();
  if (error) throw new Error(`Profil introuvable : ${error.message}`);
  return found;
}

export async function getMonthlySpend(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("monthly_spend").select("spent_usd").maybeSingle();
  // Une lecture ratée ne vaut pas « rien dépensé » : les garde-fous du budget en dépendent.
  if (error) throw new Error(`Dépense du mois illisible : ${error.message}`);
  return Number(data?.spent_usd ?? 0);
}

/** Dépense du mois tous comptes confondus, pour le plafond `GLOBAL_MONTHLY_BUDGET_USD`. */
export async function getGlobalMonthlySpend(): Promise<number> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await createAdminClient().rpc("spend_since", { p_since: since });
  if (error) throw new Error(`Dépense globale illisible : ${error.message}`);
  return Number(data);
}

export async function listCourses(search?: string): Promise<Course[]> {
  const supabase = await createClient();
  let query = supabase
    .from("courses")
    .select(COURSE_COLUMNS)
    .order("created_at", { ascending: false });
  const term = search?.trim();
  if (term) query = query.ilike("title", `%${term.replace(/[%_\\]/g, "\\$&")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function getCourse(courseId: string): Promise<Course | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select(COURSE_COLUMNS)
    .eq("id", courseId)
    .maybeSingle();
  return data;
}

/** Cours reçus en partage : identifiant du cours → adresse de la personne qui le partage. */
export async function listSharedWithMe(userId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_shares")
    .select("course_id, owner_email")
    .neq("owner_id", userId);
  return new Map((data ?? []).map((s) => [s.course_id, s.owner_email]));
}

/** Adresses avec qui la propriétaire partage ce cours. */
export async function listShareRecipients(courseId: string, ownerId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_shares")
    .select("recipient_email")
    .eq("course_id", courseId)
    .eq("owner_id", ownerId)
    .order("created_at");
  return (data ?? []).map((s) => s.recipient_email);
}

export type Folder = Pick<Tables["folders"]["Row"], "id" | "name">;

export async function listFolders(): Promise<Folder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("folders").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return data;
}

/** Rangement du compte : identifiant du cours → identifiant de son dossier. */
export async function listCourseFolders(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("course_folders").select("course_id, folder_id");
  if (error) throw new Error(error.message);
  return new Map(data.map((row) => [row.course_id, row.folder_id]));
}

export async function listSections(courseId: string): Promise<Section[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sections")
    .select("*")
    .eq("course_id", courseId)
    .order("idx");
  return data ?? [];
}

export type Passage = Pick<Tables["chunks"]["Row"], "id" | "section_id" | "caption" | "start_ms">;

/** Passages d'un cours, dans l'ordre, pour en refaire un. Lus par pages de 1 000 lignes. */
export async function listPassages(courseId: string): Promise<Passage[]> {
  const supabase = await createClient();
  const passages: Passage[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("chunks")
      .select("id, section_id, caption, start_ms")
      .eq("course_id", courseId)
      .order("idx")
      .range(from, from + 999);
    passages.push(...(data ?? []));
    if (!data || data.length < 1000) return passages;
  }
}

export type PassageMark = Pick<
  Tables["passage_marks"]["Row"],
  "id" | "position_ms" | "caption" | "created_at"
>;

/** Passages marqués « Je n'ai pas compris » par l'utilisatrice, dans l'ordre de la piste. */
export async function listPassageMarks(courseId: string, userId: string): Promise<PassageMark[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("passage_marks")
    .select("id, position_ms, caption, created_at")
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .order("position_ms");
  return data ?? [];
}

export async function listRenders(courseId: string): Promise<Render[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("renders").select("*").eq("course_id", courseId);
  return data ?? [];
}

export async function listPlayback(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("playback_progress").select("course_id, position_ms");
  return new Map((data ?? []).map((p) => [p.course_id, p.position_ms]));
}

export async function listFlaggedCourseIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sections")
    .select("course_id")
    .eq("verified", false)
    .not("verify_report", "is", null);
  return new Set((data ?? []).map((s) => s.course_id));
}

/**
 * Voix de l'utilisatrice dans le projet Gemini courant (`APP_ENV`). À la première visite,
 * des voix de départ sont ajoutées : voix factices en mock, voix prédéfinies Gemini sinon.
 */
export async function listVoices(userId: string): Promise<Voice[]> {
  const supabase = await createClient();
  const appEnv = env().APP_ENV;
  const load = async () =>
    (await supabase.from("voices").select("*").eq("env", appEnv).order("created_at")).data ?? [];

  const voices = await load();
  if (voices.length > 0) return voices;

  const mock = env().AI_MODE === "mock";
  const starters = mock
    ? VOICE_PRESETS.map((p) => ({
        provider: "mock",
        provider_voice_id: `mock_voice_${p.slug}`,
        kind: "designed",
        label: p.label,
        description: "Voix factice du mode mock (sinusoïde).",
      }))
    : PREBUILT_VOICES.map((v) => ({
        provider: "gemini",
        provider_voice_id: v.id,
        kind: "prebuilt",
        label: v.label,
        description: v.description,
      }));
  // Deux requêtes simultanées sèment la même liste : l'index unique écarte les doublons.
  await createAdminClient()
    .from("voices")
    .upsert(
      starters.map((v) => ({ ...v, user_id: userId, env: appEnv })),
      { onConflict: "user_id,env,provider_voice_id", ignoreDuplicates: true },
    );
  return load();
}

/** Cours terminés par voix × mode, pour le débit mesuré de l'estimation. */
export async function listMeasured(
  userId: string,
): Promise<{ voiceId: string; mode: Course["mode"]; sourceChars: number; durationMs: number }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("voice_id, mode, source_chars, duration_ms")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(60);
  return (data ?? []).flatMap((c) =>
    c.voice_id && c.source_chars && c.duration_ms
      ? [
          {
            voiceId: c.voice_id,
            mode: c.mode,
            sourceChars: c.source_chars,
            durationMs: c.duration_ms,
          },
        ]
      : [],
  );
}

export type CourseUsage = {
  courseId: string;
  title: string;
  createdAt: string;
  estUsd: number | null;
  actualUsd: number;
};

/** Historique des 30 derniers cours : coût estimé et coût réel de chacun. */
export async function listCourseUsage(userId: string): Promise<CourseUsage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("id, title, created_at, est_cost_usd")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  // Somme faite en SQL (vue `course_costs`) : une ligne par cours, jamais tronquée.
  const { data: costs } = await supabase
    .from("course_costs")
    .select("course_id, cost_usd")
    .in(
      "course_id",
      (data ?? []).map((c) => c.id),
    );
  const actual = new Map<string, number>();
  for (const c of costs ?? []) {
    if (c.course_id) actual.set(c.course_id, Number(c.cost_usd ?? 0));
  }
  return (data ?? []).map((c) => ({
    courseId: c.id,
    title: c.title,
    createdAt: c.created_at,
    estUsd: c.est_cost_usd === null ? null : Number(c.est_cost_usd),
    actualUsd: actual.get(c.id) ?? 0,
  }));
}

/** Modèles facturés : « mock » partout en mode mock, pour une estimation à zéro. */
export function billingModels(): { models: EstimateModels; mock: boolean } {
  const e = env();
  const mock = e.AI_MODE === "mock";
  return {
    mock,
    models: mock
      ? { text: MOCK_MODEL, check: MOCK_MODEL, tts: MOCK_MODEL, ttsLite: MOCK_MODEL }
      : {
          text: e.GEMINI_MODEL_TEXT,
          check: e.GEMINI_MODEL_CHECK,
          tts: e.GEMINI_MODEL_TTS,
          ttsLite: e.GEMINI_MODEL_TTS_LITE,
        },
  };
}
