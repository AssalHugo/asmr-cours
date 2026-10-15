import { z } from "zod";
import { chunkHash, chunkSection, quizChunks, ttsDelivery } from "@/lib/pipeline/chunker";
import type { CourseRow, NewChunk, VoiceRow } from "@/lib/pipeline/repo";
import { Script } from "@/lib/pipeline/schemas";
import { keys } from "@/lib/storage/keys";
import { PipelineError, type Ctx } from "./context";
import { sectionQuiz } from "./quiz";

/** Modèle TTS du cours selon sa qualité. */
export function ttsModel(ctx: Ctx): string {
  const { models } = ctx.deps.ai;
  return ctx.course.quality === "economy" ? models.ttsLite : models.tts;
}

/** Voix du cours, rattachée au projet Gemini de l'environnement courant. */
export async function courseVoice(ctx: Ctx): Promise<VoiceRow> {
  const { repo, appEnv } = ctx.deps;
  const voice = ctx.course.voice_id ? await repo.getVoice(ctx.course.voice_id, ctx.userId) : null;
  if (!voice) throw new PipelineError("La voix de ce cours n'existe plus. Choisis-en une autre.");
  if (voice.env !== appEnv) {
    throw new PipelineError(
      "Cette voix appartient à un autre environnement Gemini. Choisis une voix de celui-ci.",
    );
  }
  return voice;
}

const ChunkTakes = z.record(z.string(), z.number().int().positive());

/** Prises refaites du cours : hash d'origine du passage → numéro de la prise en cours. */
export function chunkTakes(course: Pick<CourseRow, "chunk_takes">): Record<string, number> {
  const parsed = ChunkTakes.safeParse(course.chunk_takes);
  return parsed.success ? parsed.data : {};
}

/** Hash d'un passage pour une prise donnée ; la prise 0 est celle d'origine, partagée. */
export function takeHash(
  course: Pick<CourseRow, "id">,
  base: { model: string; voiceId: string; style: string; text: string },
  take: number,
): string {
  return chunkHash(
    base.model,
    base.voiceId,
    base.style,
    base.text,
    take > 0 ? `${course.id}:${take}` : undefined,
  );
}

/**
 * §8.4 — Découpe tous les scripts en chunks. Les chunks sont un état dérivé : ils sont
 * recalculés à chaque passage, et ceux dont le hash n'a pas changé gardent leur audio.
 */
export async function chunkStep(ctx: Ctx): Promise<void> {
  const { repo, ai } = ctx.deps;
  const voice = await courseVoice(ctx);
  const model = ttsModel(ctx);
  const { style, tag } = ttsDelivery(ctx.course.mode, ctx.course.tier);
  const takes = chunkTakes(ctx.course);

  const previous = new Map(
    (await repo.listChunks(ctx.course.id))
      .filter((c) => c.status === "done" && c.audio_key)
      .map((c) => [c.hash, c.audio_key]),
  );

  const sections = await repo.listSections(ctx.course.id);
  const addressForm = ctx.course.address_form === "vous" ? "vous" : "tu";
  const rows: NewChunk[] = [];
  for (const [index, section] of sections.entries()) {
    if (section.script === null) throw new PipelineError("Une section n'a pas encore de script.");
    const quiz = ctx.course.quiz ? sectionQuiz(section) : null;
    const plans = [
      ...chunkSection(Script.parse(section.script).segments),
      ...(quiz ? quizChunks(quiz, { addressForm, isLast: index === sections.length - 1 }) : []),
    ];
    for (const plan of plans) {
      const text = tag + ai.tts.renderChunkText(plan.segments);
      const base = { model, voiceId: voice.provider_voice_id, style, text };
      const hash = takeHash(ctx.course, base, takes[takeHash(ctx.course, base, 0)] ?? 0);
      const cached = previous.has(hash);
      rows.push({
        section_id: section.id,
        idx: rows.length,
        kind: plan.kind,
        text,
        caption: plan.caption,
        style,
        pause_after_ms: plan.pauseAfterMs,
        hash,
        audio_key: cached ? keys.ttsCache(hash) : null,
        status: cached ? "done" : "pending",
      });
    }
  }
  if (rows.length === 0) throw new PipelineError("Le script de ce cours est vide.");
  await repo.replaceChunks(ctx.course.id, rows);
  await repo.touchVoice(voice.id, ctx.deps.now());
}
