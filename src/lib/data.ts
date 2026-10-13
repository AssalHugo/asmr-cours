import "server-only";
import { env } from "@/lib/env";
import type { EstimateModels } from "@/lib/estimate";
import { MOCK_MODEL } from "@/lib/pricing";
import { PREBUILT_VOICES, VOICE_PRESETS } from "@/lib/prompts/voice-presets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type Tables = Database["public"]["Tables"];
export type Course = Tables["courses"]["Row"];
export type Section = Tables["sections"]["Row"];
export type Voice = Tables["voices"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type Render = Tables["renders"]["Row"];

/** Lectures de l'app : client de session, donc filtrées par la RLS. */

export async function getProfile(userId: string): Promise<Profile> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (data) return data;
  // Compte créé avant le trigger d'inscription : on répare.
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("profiles")
    .upsert({ id: userId, monthly_budget_usd: env().MONTHLY_BUDGET_USD })
    .select("*")
    .single();
  if (error) throw new Error(`Profil introuvable : ${error.message}`);
  return created;
}

export async function getMonthlySpend(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("monthly_spend").select("spent_usd").maybeSingle();
  return Number(data?.spent_usd ?? 0);
}

export async function listCourses(search?: string): Promise<Course[]> {
  const supabase = await createClient();
  let query = supabase.from("courses").select("*").order("created_at", { ascending: false });
  const term = search?.trim();
  if (term) query = query.ilike("title", `%${term.replace(/[%_\\]/g, "\\$&")}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function getCourse(courseId: string): Promise<Course | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("courses").select("*").eq("id", courseId).maybeSingle();
  return data;
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
  await createAdminClient()
    .from("voices")
    .insert(starters.map((v) => ({ ...v, user_id: userId, env: appEnv })));
  return load();
}

/** Cours terminés par voix × mode, pour le débit mesuré de l'estimation. */
export async function listMeasured(): Promise<
  { voiceId: string; mode: Course["mode"]; sourceChars: number; durationMs: number }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("voice_id, mode, source_chars, duration_ms")
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

/** Historique du mois : coût estimé et coût réel de chaque cours. */
export async function listCourseUsage(): Promise<CourseUsage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("courses")
    .select("id, title, created_at, est_cost_usd")
    .order("created_at", { ascending: false })
    .limit(30);
  const { data: events } = await supabase.from("usage_events").select("course_id, cost_usd");
  const actual = new Map<string, number>();
  for (const e of events ?? []) {
    if (e.course_id) actual.set(e.course_id, (actual.get(e.course_id) ?? 0) + Number(e.cost_usd));
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
