import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json, PipelineRepo } from "./repo";

class RepoError extends Error {
  constructor(operation: string, message: string) {
    super(`Base de données (${operation}) : ${message}`);
    this.name = "RepoError";
  }
}

function check<T>(operation: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new RepoError(operation, result.error.message);
  return result.data;
}

function rows<T>(
  operation: string,
  result: { data: T[] | null; error: { message: string } | null },
): T[] {
  return check(operation, result) ?? [];
}

const asJson = (value: unknown) => value as Json;

const monthStart = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();

/**
 * Dépôt du pipeline sur Supabase, avec la clé secrète (contourne la RLS) :
 * chaque accès à un cours est donc filtré par `user_id`.
 */
export function createSupabaseRepo(db: AdminClient): PipelineRepo {
  return {
    async getCourse(courseId, userId) {
      return check(
        "getCourse",
        await db.from("courses").select("*").eq("id", courseId).eq("user_id", userId).maybeSingle(),
      );
    },
    async updateCourse(courseId, userId, patch) {
      check(
        "updateCourse",
        await db.from("courses").update(patch).eq("id", courseId).eq("user_id", userId),
      );
    },
    async getProfile(userId) {
      return check(
        "getProfile",
        await db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      );
    },
    async getVoice(voiceId, userId) {
      return check(
        "getVoice",
        await db.from("voices").select("*").eq("id", voiceId).eq("user_id", userId).maybeSingle(),
      );
    },
    async touchVoice(voiceId, at) {
      check(
        "touchVoice",
        await db.from("voices").update({ last_used_at: at.toISOString() }).eq("id", voiceId),
      );
    },

    async listSections(courseId) {
      return rows(
        "listSections",
        await db.from("sections").select("*").eq("course_id", courseId).order("idx"),
      );
    },
    async insertSections(courseId, sections) {
      check(
        "insertSections",
        await db.from("sections").insert(sections.map((s) => ({ ...s, course_id: courseId }))),
      );
    },
    async updateSection(sectionId, patch) {
      const { script, verify_report: report, ...rest } = patch;
      check(
        "updateSection",
        await db
          .from("sections")
          .update({
            ...rest,
            ...(script !== undefined ? { script: asJson(script) } : {}),
            ...(report !== undefined ? { verify_report: asJson(report) } : {}),
          })
          .eq("id", sectionId),
      );
    },

    async listChunks(courseId) {
      return rows(
        "listChunks",
        await db.from("chunks").select("*").eq("course_id", courseId).order("idx"),
      );
    },
    async replaceChunks(courseId, chunks) {
      check("replaceChunks", await db.from("chunks").delete().eq("course_id", courseId));
      for (let i = 0; i < chunks.length; i += 200) {
        check(
          "replaceChunks",
          await db
            .from("chunks")
            .insert(chunks.slice(i, i + 200).map((c) => ({ ...c, course_id: courseId }))),
        );
      }
    },
    async updateChunk(chunkId, patch) {
      check("updateChunk", await db.from("chunks").update(patch).eq("id", chunkId));
    },
    async markChunksDone(courseId, hash, audioKey) {
      check(
        "markChunksDone",
        await db
          .from("chunks")
          .update({ status: "done", audio_key: audioKey })
          .eq("course_id", courseId)
          .eq("hash", hash),
      );
    },

    async listRenders(courseId) {
      return rows("listRenders", await db.from("renders").select("*").eq("course_id", courseId));
    },
    async saveRender(render) {
      const existing = db
        .from("renders")
        .delete()
        .eq("course_id", render.course_id)
        .eq("kind", render.kind);
      check(
        "saveRender",
        await (render.ambience === null
          ? existing.is("ambience", null)
          : existing.eq("ambience", render.ambience)),
      );
      check("saveRender", await db.from("renders").insert(render));
    },
    async deleteRenders(courseId, keep) {
      const all = rows(
        "deleteRenders",
        await db.from("renders").select("*").eq("course_id", courseId),
      );
      const stale = all.filter(
        (r) => !keep.some((k) => k.kind === r.kind && k.ambience === r.ambience),
      );
      if (stale.length > 0) {
        check(
          "deleteRenders",
          await db
            .from("renders")
            .delete()
            .in(
              "id",
              stale.map((r) => r.id),
            ),
        );
      }
      return stale;
    },

    async insertUsage(event) {
      check(
        "insertUsage",
        await db.from("usage_events").insert({
          user_id: event.userId,
          course_id: event.courseId,
          step: event.step,
          model: event.model,
          tier: event.tier,
          input_tokens: Math.round(event.usage.inputTokens),
          output_tokens: Math.round(event.usage.outputTokens),
          thinking_tokens: Math.round(event.usage.thinkingTokens),
          audio_seconds: Number(event.usage.audioSeconds.toFixed(2)),
          cost_usd: Number(event.costUsd.toFixed(5)),
        }),
      );
    },
    // Sommes faites en SQL : une lecture ligne à ligne serait tronquée à 1 000 lignes.
    async monthlySpend(userId, at) {
      return Number(
        check(
          "monthlySpend",
          await db.rpc("spend_since", { p_since: monthStart(at), p_user_id: userId }),
        ),
      );
    },
    async globalMonthlySpend(at) {
      return Number(
        check("globalMonthlySpend", await db.rpc("spend_since", { p_since: monthStart(at) })),
      );
    },
    async courseCost(courseId) {
      return Number(check("courseCost", await db.rpc("course_cost", { p_course_id: courseId })));
    },
    async measuredCourses(userId, voiceId, mode) {
      if (!voiceId) return [];
      const found = rows(
        "measuredCourses",
        await db
          .from("courses")
          .select("source_chars, duration_ms")
          .eq("user_id", userId)
          .eq("voice_id", voiceId)
          .eq("mode", mode)
          .eq("status", "ready")
          .order("created_at", { ascending: false })
          .limit(10),
      );
      return found.flatMap((r) =>
        r.source_chars && r.duration_ms
          ? [{ sourceChars: r.source_chars, durationMs: r.duration_ms }]
          : [],
      );
    },
  };
}
