import { randomUUID } from "node:crypto";
import type {
  ChunkRow,
  CourseRow,
  PipelineRepo,
  ProfileRow,
  RenderRow,
  SectionRow,
  UsageEvent,
  VoiceRow,
} from "@/lib/pipeline/repo";

/** Dépôt en mémoire pour les tests d'intégration du pipeline. */
export class MemoryRepo implements PipelineRepo {
  courses = new Map<string, CourseRow>();
  profiles = new Map<string, ProfileRow>();
  voices = new Map<string, VoiceRow>();
  sections: SectionRow[] = [];
  chunks: ChunkRow[] = [];
  renders: RenderRow[] = [];
  usage: (UsageEvent & { at: Date })[] = [];

  async getCourse(courseId: string, userId: string) {
    const course = this.courses.get(courseId);
    return course && course.user_id === userId ? { ...course } : null;
  }
  async updateCourse(courseId: string, userId: string, patch: Partial<CourseRow>) {
    const course = this.courses.get(courseId);
    if (course && course.user_id === userId) Object.assign(course, patch);
  }
  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async getVoice(voiceId: string, userId: string) {
    const voice = this.voices.get(voiceId);
    return voice && voice.user_id === userId ? voice : null;
  }
  async touchVoice(voiceId: string, at: Date) {
    const voice = this.voices.get(voiceId);
    if (voice) voice.last_used_at = at.toISOString();
  }

  async listSections(courseId: string) {
    return this.sections.filter((s) => s.course_id === courseId).sort((a, b) => a.idx - b.idx);
  }
  async insertSections(courseId: string, sections: Parameters<PipelineRepo["insertSections"]>[1]) {
    for (const s of sections) {
      this.sections.push({
        id: randomUUID(),
        course_id: courseId,
        script: null,
        verified: false,
        verify_report: null,
        quiz: null,
        start_ms: null,
        duration_ms: null,
        ...s,
      });
    }
  }
  async updateSection(sectionId: string, patch: Parameters<PipelineRepo["updateSection"]>[1]) {
    const section = this.sections.find((s) => s.id === sectionId);
    if (section) Object.assign(section, patch);
  }

  async listChunks(courseId: string) {
    return this.chunks.filter((c) => c.course_id === courseId).sort((a, b) => a.idx - b.idx);
  }
  async replaceChunks(courseId: string, chunks: Parameters<PipelineRepo["replaceChunks"]>[1]) {
    this.chunks = this.chunks.filter((c) => c.course_id !== courseId);
    for (const c of chunks) {
      this.chunks.push({
        id: randomUUID(),
        course_id: courseId,
        start_ms: null,
        duration_ms: null,
        ...c,
      });
    }
  }
  async updateChunk(chunkId: string, patch: Partial<ChunkRow>) {
    const chunk = this.chunks.find((c) => c.id === chunkId);
    if (chunk) Object.assign(chunk, patch);
  }
  async markChunksDone(courseId: string, hash: string, audioKey: string) {
    for (const c of this.chunks) {
      if (c.course_id === courseId && c.hash === hash)
        Object.assign(c, { status: "done", audio_key: audioKey });
    }
  }

  async listRenders(courseId: string) {
    return this.renders.filter((r) => r.course_id === courseId);
  }
  async saveRender(render: Omit<RenderRow, "id" | "created_at">) {
    this.renders = this.renders.filter(
      (r) =>
        !(
          r.course_id === render.course_id &&
          r.kind === render.kind &&
          r.ambience === render.ambience
        ),
    );
    this.renders.push({ id: randomUUID(), created_at: new Date().toISOString(), ...render });
  }
  async deleteRenders(courseId: string, keep: { kind: string; ambience: string | null }[]) {
    const isKept = (r: RenderRow) =>
      keep.some((k) => k.kind === r.kind && k.ambience === r.ambience);
    const removed = this.renders.filter((r) => r.course_id === courseId && !isKept(r));
    this.renders = this.renders.filter((r) => !removed.includes(r));
    return removed;
  }

  async insertUsage(event: UsageEvent) {
    this.usage.push({ ...event, at: new Date() });
  }
  async monthlySpend(userId: string) {
    return this.usage.filter((u) => u.userId === userId).reduce((sum, u) => sum + u.costUsd, 0);
  }
  async globalMonthlySpend() {
    return this.usage.reduce((sum, u) => sum + u.costUsd, 0);
  }
  async courseCost(courseId: string) {
    return this.usage.filter((u) => u.courseId === courseId).reduce((sum, u) => sum + u.costUsd, 0);
  }
  async measuredCourses() {
    return [];
  }
}

export function makeProfile(id: string, monthlyBudgetUsd = 10): ProfileRow {
  return {
    id,
    display_name: "Test",
    default_voice_id: null,
    default_mode: "whisper",
    default_ambience: "rain",
    default_tier: "eco",
    default_quality: "standard",
    address_form: "tu",
    monthly_budget_usd: monthlyBudgetUsd,
    created_at: new Date().toISOString(),
  };
}

export function makeVoice(userId: string): VoiceRow {
  return {
    id: randomUUID(),
    user_id: userId,
    env: "dev",
    provider: "mock",
    provider_voice_id: "mock_voice_test",
    kind: "designed",
    label: "Voix de test",
    description: null,
    sample_key: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
  };
}

export function makeCourse(
  userId: string,
  voiceId: string,
  patch: Partial<CourseRow> = {},
): CourseRow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    user_id: userId,
    title: "Cours de test",
    source_kind: "text",
    source_keys: [],
    source_chars: null,
    mode: "whisper",
    tier: "express",
    quality: "standard",
    voice_id: voiceId,
    ambience: "pink-noise",
    ambience_gain_db: -6,
    address_form: "tu",
    quiz: false,
    is_sample: false,
    status: "queued",
    progress: 0,
    error: null,
    trigger_run_id: null,
    batch_job_id: null,
    batch_submitted_at: null,
    chunk_takes: {},
    est_cost_usd: null,
    actual_cost_usd: 0,
    duration_ms: null,
    created_at: now,
    updated_at: now,
    ...patch,
  };
}
