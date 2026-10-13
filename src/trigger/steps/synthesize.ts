import { DEFAULT_RATE } from "@/lib/estimate";
import { speechDurationPlausible } from "@/lib/pipeline/chunker";
import type { ChunkRow } from "@/lib/pipeline/repo";
import { costUsd } from "@/lib/pricing";
import { mapLimit } from "@/lib/retry";
import { keys } from "@/lib/storage/keys";
import type { TtsRequest, TtsResult } from "@/lib/tts/provider";
import { assertBudget, patchCourse, recordUsage, setStatus, type Ctx } from "./context";
import { courseVoice, ttsModel } from "./chunk";

type Job = { ctx: Ctx; model: string; total: number; done: number };

/** Un chunk par hash : deux chunks identiques ne sont synthétisés qu'une fois. */
function uniqueByHash(chunks: ChunkRow[]): ChunkRow[] {
  return [...new Map(chunks.map((c) => [c.hash, c])).values()];
}

/** Range l'audio dans le cache, journalise son coût et marque les chunks concernés. */
async function store(job: Job, result: TtsResult, tier: "standard" | "batch"): Promise<void> {
  const { ctx } = job;
  const key = keys.ttsCache(result.key);
  await ctx.deps.storage.put(key, result.wav, "audio/wav");
  await recordUsage(ctx, "tts", job.model, tier, result.usage);
  await ctx.deps.repo.markChunksDone(ctx.course.id, result.key, key);
  ctx.producedMs += result.durationMs;
  job.done++;
}

const progress = (job: Job) => (job.total === 0 ? 1 : job.done / job.total);

/** Coût d'une synthèse en appels standard des chunks restants, pour le contrôle du budget. */
function standardCostUsd(ctx: Ctx, model: string, chunks: ChunkRow[]): number {
  const chars = chunks.reduce((sum, c) => sum + c.caption.length, 0);
  const audioSeconds = chars / DEFAULT_RATE[ctx.course.mode];
  return costUsd(
    model,
    "standard",
    { inputTokens: Math.ceil(chars / 3.5), outputTokens: 0, thinkingTokens: 0, audioSeconds },
    ctx.deps.now(),
  );
}

async function runStandard(job: Job, chunks: ChunkRow[], voiceId: string): Promise<void> {
  const { ctx } = job;
  await setStatus(ctx, "synthesizing", progress(job));
  await mapLimit(chunks, ctx.deps.limits.ttsConcurrency, async (chunk) => {
    const request: TtsRequest = {
      key: chunk.hash,
      text: chunk.text,
      voiceId,
      style: chunk.style,
      model: job.model,
    };
    let result = await ctx.deps.ai.tts.synthesize(request);
    if (!speechDurationPlausible(chunk.caption.length, result.durationMs)) {
      // Passage tronqué ou parti en roue libre : la prise rejetée est facturée, donc
      // journalisée, puis refaite une seule fois. La seconde est gardée quoi qu'il arrive.
      await recordUsage(ctx, "tts", job.model, "standard", result.usage);
      result = await ctx.deps.ai.tts.synthesize(request);
    }
    await store(job, result, "standard");
    await setStatus(ctx, "synthesizing", progress(job));
  });
}

/**
 * Mode Éco : un seul job Batch pour tous les chunks manquants, sondé à intervalle régulier.
 * Renvoie les chunks restés sans audio (job échoué, expiré, ou requêtes en erreur).
 */
async function runBatch(job: Job, chunks: ChunkRow[], voiceId: string): Promise<ChunkRow[]> {
  const { ctx } = job;
  const { tts } = ctx.deps.ai;
  const { now, wait, batchPollSeconds, batchTimeoutMs } = ctx.deps;
  if (!tts.submitBatch || !tts.pollBatch) return chunks;

  // Une reprise relit tout le fichier de résultats : seuls les chunks encore attendus sont
  // rangés et facturés, les autres l'ont déjà été.
  const wanted = new Map(chunks.map((c) => [c.hash, c.caption.length]));
  const received = new Set<string>();
  const clear = () => patchCourse(ctx, { batch_job_id: null, batch_submitted_at: null });

  let jobId = ctx.course.batch_job_id;
  if (!jobId) {
    const requests: TtsRequest[] = chunks.map((c) => ({
      key: c.hash,
      text: c.text,
      voiceId,
      style: c.style,
      model: job.model,
    }));
    try {
      ({ jobId } = await tts.submitBatch(requests, `murmure-${ctx.course.id}`));
    } catch {
      // Batch indisponible (free tier, modèle non pris en charge) : repli sur l'API standard.
      return chunks;
    }
    // La création d'un job n'est pas idempotente : son identifiant est persisté aussitôt.
    await patchCourse(ctx, { batch_job_id: jobId, batch_submitted_at: now().toISOString() });
  }
  const submittedAt = Date.parse(ctx.course.batch_submitted_at ?? now().toISOString());

  for (;;) {
    await setStatus(ctx, "waiting_batch", progress(job));
    const poll = await tts.pollBatch(jobId, async (result) => {
      const spokenChars = wanted.get(result.key);
      if (spokenChars === undefined || received.has(result.key)) return;
      if (!speechDurationPlausible(spokenChars, result.durationMs)) {
        // Audio aberrant : facturé, mais écarté. Le chunk repart en appel standard.
        await recordUsage(ctx, "tts", job.model, "batch", result.usage);
        return;
      }
      received.add(result.key);
      await store(job, result, "batch");
    });
    if (poll.state === "done" || poll.state === "failed") break;
    if (now().getTime() - submittedAt > batchTimeoutMs) {
      await tts.cancelBatch?.(jobId).catch(() => undefined);
      break;
    }
    await wait(batchPollSeconds);
  }
  await clear();
  return chunks.filter((c) => !received.has(c.hash));
}

/**
 * §8.5 — Synthèse des chunks sans audio. Le cache par hash passe d'abord : un chunk
 * inchangé n'est jamais refacturé.
 */
export async function synthStep(ctx: Ctx): Promise<void> {
  const { repo, storage } = ctx.deps;
  const all = await repo.listChunks(ctx.course.id);
  const pending = uniqueByHash(all.filter((c) => c.status !== "done"));
  if (pending.length === 0) return;

  const job: Job = { ctx, model: ttsModel(ctx), total: pending.length, done: 0 };
  await setStatus(ctx, "synthesizing");

  const missing: ChunkRow[] = [];
  await mapLimit(pending, 8, async (chunk) => {
    const key = keys.ttsCache(chunk.hash);
    if (await storage.head(key)) {
      await repo.markChunksDone(ctx.course.id, chunk.hash, key);
      job.done++;
    } else {
      missing.push(chunk);
    }
  });
  if (missing.length === 0) return;
  missing.sort((a, b) => a.idx - b.idx);

  const voice = await courseVoice(ctx);
  let remaining = missing;
  if (ctx.course.tier === "eco" && !ctx.forceStandard) {
    remaining = await runBatch(job, missing, voice.provider_voice_id);
    // Bascule en Express pour le reste, après contrôle du budget.
    if (remaining.length > 0) await assertBudget(ctx, standardCostUsd(ctx, job.model, remaining));
  }
  if (remaining.length > 0) await runStandard(job, remaining, voice.provider_voice_id);
  await setStatus(ctx, "synthesizing", 1);
}
