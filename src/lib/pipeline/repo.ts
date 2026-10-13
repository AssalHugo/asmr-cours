import type { BillingTier, BillableUsage } from "@/lib/pricing";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Script, VerifyReport } from "./schemas";

type Tables = Database["public"]["Tables"];
export type CourseRow = Tables["courses"]["Row"];
export type SectionRow = Tables["sections"]["Row"];
export type ChunkRow = Tables["chunks"]["Row"];
export type RenderRow = Tables["renders"]["Row"];
export type VoiceRow = Tables["voices"]["Row"];
export type ProfileRow = Tables["profiles"]["Row"];
export type { Json };

export type CoursePatch = Partial<
  Pick<
    CourseRow,
    | "title"
    | "source_chars"
    | "status"
    | "progress"
    | "error"
    | "trigger_run_id"
    | "batch_job_id"
    | "batch_submitted_at"
    | "est_cost_usd"
    | "actual_cost_usd"
    | "duration_ms"
    | "ambience"
    | "ambience_gain_db"
  >
>;

export type NewSection = {
  idx: number;
  title: string;
  source_text: string;
  key_terms: string[];
  key_facts: string[];
};

/** Rapport stocké : le rapport de fidélité, plus les écarts de forme tolérés. */
export type StoredReport = VerifyReport & { formWarnings?: string[] };

export type SectionPatch = {
  script?: Script | null;
  verified?: boolean;
  verify_report?: StoredReport | null;
  start_ms?: number | null;
  duration_ms?: number | null;
};

export type NewChunk = {
  section_id: string;
  idx: number;
  text: string;
  caption: string;
  style: string;
  pause_after_ms: number;
  hash: string;
  audio_key: string | null;
  status: "pending" | "done";
};

export type ChunkPatch = Partial<
  Pick<ChunkRow, "audio_key" | "status" | "start_ms" | "duration_ms">
>;

export type UsageEvent = {
  userId: string;
  courseId: string | null;
  step: string;
  model: string;
  tier: BillingTier;
  usage: BillableUsage;
  costUsd: number;
};

/**
 * Accès aux données du pipeline. L'implémentation Supabase utilise la clé secrète :
 * toute lecture ou écriture de cours est donc filtrée par `userId`.
 */
export interface PipelineRepo {
  getCourse(courseId: string, userId: string): Promise<CourseRow | null>;
  updateCourse(courseId: string, userId: string, patch: CoursePatch): Promise<void>;
  getProfile(userId: string): Promise<ProfileRow | null>;
  getVoice(voiceId: string, userId: string): Promise<VoiceRow | null>;
  touchVoice(voiceId: string, at: Date): Promise<void>;

  listSections(courseId: string): Promise<SectionRow[]>;
  insertSections(courseId: string, sections: NewSection[]): Promise<void>;
  updateSection(sectionId: string, patch: SectionPatch): Promise<void>;

  listChunks(courseId: string): Promise<ChunkRow[]>;
  /** Remplace tous les chunks du cours (état dérivé des scripts). */
  replaceChunks(courseId: string, chunks: NewChunk[]): Promise<void>;
  updateChunk(chunkId: string, patch: ChunkPatch): Promise<void>;
  /** Marque comme synthétisés tous les chunks du cours portant ce hash. */
  markChunksDone(courseId: string, hash: string, audioKey: string): Promise<void>;

  listRenders(courseId: string): Promise<RenderRow[]>;
  /** Remplace le rendu de même nature et de même ambiance. */
  saveRender(render: Omit<RenderRow, "id" | "created_at">): Promise<void>;
  deleteRenders(
    courseId: string,
    keep: { kind: "voice" | "mix"; ambience: string | null }[],
  ): Promise<RenderRow[]>;

  insertUsage(event: UsageEvent): Promise<void>;
  /** Dépense du mois courant de l'utilisatrice. */
  monthlySpend(userId: string, at: Date): Promise<number>;
  /** Dépense du mois courant, tous comptes confondus (plafond global). */
  globalMonthlySpend(at: Date): Promise<number>;
  /** Coût réel cumulé d'un cours. */
  courseCost(courseId: string): Promise<number>;
  /** Cours terminés avec la même voix et le même mode, pour mesurer le débit. */
  measuredCourses(
    userId: string,
    voiceId: string | null,
    mode: CourseRow["mode"],
  ): Promise<{ sourceChars: number; durationMs: number }[]>;
}
