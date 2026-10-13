import { chunkHash, chunkSection, TTS_STYLE } from "@/lib/pipeline/chunker";
import type { NewChunk, VoiceRow } from "@/lib/pipeline/repo";
import { Script } from "@/lib/pipeline/schemas";
import { keys } from "@/lib/storage/keys";
import { PipelineError, type Ctx } from "./context";

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

/**
 * §8.4 — Découpe tous les scripts en chunks. Les chunks sont un état dérivé : ils sont
 * recalculés à chaque passage, et ceux dont le hash n'a pas changé gardent leur audio.
 */
export async function chunkStep(ctx: Ctx): Promise<void> {
  const { repo, ai } = ctx.deps;
  const voice = await courseVoice(ctx);
  const model = ttsModel(ctx);
  const style = TTS_STYLE[ctx.course.mode];

  const previous = new Map(
    (await repo.listChunks(ctx.course.id))
      .filter((c) => c.status === "done" && c.audio_key)
      .map((c) => [c.hash, c.audio_key]),
  );

  const sections = await repo.listSections(ctx.course.id);
  const rows: NewChunk[] = [];
  for (const section of sections) {
    if (section.script === null) throw new PipelineError("Une section n'a pas encore de script.");
    for (const plan of chunkSection(Script.parse(section.script).segments)) {
      const text = ai.tts.renderChunkText(plan.segments);
      const hash = chunkHash(model, voice.provider_voice_id, style, text);
      const cached = previous.has(hash);
      rows.push({
        section_id: section.id,
        idx: rows.length,
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
