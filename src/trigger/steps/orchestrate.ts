import { TTS_STYLE } from "@/lib/pipeline/chunker";
import type {
  GenerateCoursePayload,
  RegenerateSectionPayload,
  RemixPayload,
  VoiceSamplePayload,
} from "@/lib/pipeline/schemas";
import { VOICE_PREVIEW_SEGMENTS } from "@/lib/prompts/voice-presets";
import { keys } from "@/lib/storage/keys";
import { assembleAndPublish } from "./assemble";
import { chunkStep } from "./chunk";
import {
  assertBudget,
  loadCtx,
  patchCourse,
  PipelineError,
  recordUsage,
  userMessage,
  type PipelineDeps,
} from "./context";
import { extractStep } from "./extract";
import { rewriteStep, verifyStep } from "./rewrite";
import { synthStep } from "./synthesize";

/**
 * §8.0 — Chaque étape lit l'état en base et saute ce qui est déjà fait :
 * relancer cette fonction reprend le cours là où il s'était arrêté.
 */
export async function generateCourse(deps: PipelineDeps, payload: GenerateCoursePayload) {
  const ctx = await loadCtx(deps, payload.courseId, payload.userId);
  if (ctx.course.status === "failed") await patchCourse(ctx, { error: null });
  await extractStep(ctx, { titleIsDefault: payload.titleIsDefault });
  await rewriteStep(ctx);
  await verifyStep(ctx);
  await chunkStep(ctx);
  await synthStep(ctx);
  await assembleAndPublish(ctx);
  return { courseId: ctx.course.id, durationMs: ctx.course.duration_ms };
}

/** §8.9 — Réécriture, vérification et TTS d'une seule section, puis réassemblage. */
export async function regenerateSection(deps: PipelineDeps, payload: RegenerateSectionPayload) {
  const ctx = await loadCtx(deps, payload.courseId, payload.userId, { forceStandard: true });
  const sections = await deps.repo.listSections(ctx.course.id);
  if (!sections.some((s) => s.id === payload.sectionId)) {
    throw new PipelineError("Cette section n'existe plus.");
  }
  await deps.repo.updateSection(payload.sectionId, {
    script: null,
    verified: false,
    verify_report: null,
  });
  await rewriteStep(ctx);
  await verifyStep(ctx);
  await chunkStep(ctx);
  // Grâce au cache par hash, seuls les chunks modifiés sont payés.
  await synthStep(ctx);
  await assembleAndPublish(ctx);
  return { courseId: ctx.course.id };
}

/** §8.9 — Nouveau pré-mix avec une autre ambiance : FFmpeg seul, coût IA nul. */
export async function remixCourse(deps: PipelineDeps, payload: RemixPayload) {
  const ctx = await loadCtx(deps, payload.courseId, payload.userId);
  await patchCourse(ctx, { ambience: payload.ambience, ambience_gain_db: payload.ambienceGainDb });
  await assembleAndPublish(ctx);
  return { courseId: ctx.course.id };
}

/** §8.9 — Échantillon d'aperçu d'une voix, mis en cache par voix × mode. */
export async function voiceSample(deps: PipelineDeps, payload: VoiceSamplePayload) {
  const { repo, storage, ai } = deps;
  const voice = await repo.getVoice(payload.voiceId, payload.userId);
  if (!voice) throw new PipelineError("Cette voix n'existe plus.");
  const key = keys.voiceSample(voice.id, payload.mode);
  if (await storage.head(key)) return { key, cached: true };

  const model = ai.models.ttsLite;
  const scope = { deps, userId: payload.userId };
  const result = await ai.tts.synthesize({
    key,
    text: ai.tts.renderChunkText([...VOICE_PREVIEW_SEGMENTS]),
    voiceId: voice.provider_voice_id,
    style: TTS_STYLE[payload.mode],
    model,
  });
  await storage.put(key, result.wav, "audio/wav");
  await recordUsage(scope, "voice-sample", model, "standard", result.usage);
  await repo.touchVoice(voice.id, deps.now());
  return { key, cached: false };
}

/** Marque le cours en échec avec un message lisible. Appelé une fois les essais épuisés. */
export async function failCourse(
  deps: PipelineDeps,
  courseId: string,
  userId: string,
  error: unknown,
): Promise<string> {
  const message = userMessage(error);
  await deps.repo.updateCourse(courseId, userId, { status: "failed", error: message });
  deps.report?.({
    status: "failed",
    progress: 0,
    costUsd: await deps.repo.courseCost(courseId).catch(() => 0),
    durationMs: 0,
    error: message,
  });
  return message;
}

export { assertBudget, PipelineError };
