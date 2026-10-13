import { getAmbience } from "@/lib/ambiences";
import { isAmbienceInstalled } from "@/lib/audio/ambience-synth";
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
  type Ctx,
  type PipelineDeps,
} from "./context";
import { extractStep } from "./extract";
import { rewriteSection, rewriteStep, verifyStep } from "./rewrite";
import { synthStep } from "./synthesize";

/** Refuse de démarrer avec une ambiance absente : le cours échouerait au mix, une fois payé. */
async function assertAmbience(ctx: Ctx, id: string): Promise<void> {
  const { storage, ai } = ctx.deps;
  if (await isAmbienceInstalled(storage, id, ai.mock)) return;
  throw new PipelineError(
    `L'ambiance « ${getAmbience(id)?.label ?? id} » n'est pas encore installée. Choisis « Bruit rose », ou installe-la (docs/SETUP.md, étape Ambiances).`,
  );
}

/**
 * Plafond du budget avant les étapes payantes. Rejoué à chaque passage, reprise comprise :
 * un cours arrêté pour dépassement ne repart pas tant que le budget ne le permet pas.
 * Sauté quand il ne reste que l'assemblage, qui ne coûte rien.
 */
async function budgetGate(ctx: Ctx): Promise<void> {
  const { repo } = ctx.deps;
  const [sections, chunks] = await Promise.all([
    repo.listSections(ctx.course.id),
    repo.listChunks(ctx.course.id),
  ]);
  const textDone = sections.every((s) => s.script !== null && s.verify_report !== null);
  const audioDone = chunks.length > 0 && chunks.every((c) => c.status === "done");
  if (textDone && audioDone) return;
  await assertBudget(ctx, Math.max(0, (ctx.course.est_cost_usd ?? 0) - ctx.costUsd));
}

/**
 * §8.0 — Chaque étape lit l'état en base et saute ce qui est déjà fait :
 * relancer cette fonction reprend le cours là où il s'était arrêté.
 */
export async function generateCourse(deps: PipelineDeps, payload: GenerateCoursePayload) {
  const ctx = await loadCtx(deps, payload.courseId, payload.userId);
  if (ctx.course.status === "failed") await patchCourse(ctx, { error: null });
  await assertAmbience(ctx, ctx.course.ambience);
  await extractStep(ctx, { titleIsDefault: payload.titleIsDefault });
  await budgetGate(ctx);
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
  const section = sections.find((s) => s.id === payload.sectionId);
  if (!section) throw new PipelineError("Cette section n'existe plus.");
  // L'ancien script reste en place jusqu'à ce que le nouveau soit écrit.
  await rewriteSection(ctx, section, sections.length);
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
  await assertAmbience(ctx, payload.ambience);
  // L'ambiance n'est enregistrée qu'avec le nouveau rendu : un remix qui échoue laisse
  // le cours tel qu'il était.
  const remix = { ambience: payload.ambience, ambience_gain_db: payload.ambienceGainDb };
  Object.assign(ctx.course, remix);
  await assembleAndPublish(ctx, remix);
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

/**
 * Marque le cours en échec avec un message lisible. Appelé une fois les essais épuisés.
 * `keepReady` (remix) : rien n'a été modifié, le cours reste écoutable et garde le message.
 */
export async function failCourse(
  deps: PipelineDeps,
  courseId: string,
  userId: string,
  error: unknown,
  opts: { keepReady?: boolean } = {},
): Promise<string> {
  const message = userMessage(error);
  const status = opts.keepReady ? "ready" : "failed";
  await deps.repo.updateCourse(courseId, userId, {
    status,
    progress: opts.keepReady ? 100 : 0,
    error: message,
  });
  deps.report?.({
    status,
    progress: opts.keepReady ? 100 : 0,
    costUsd: await deps.repo.courseCost(courseId).catch(() => 0),
    durationMs: 0,
    error: message,
  });
  return message;
}

export { assertBudget, PipelineError };
