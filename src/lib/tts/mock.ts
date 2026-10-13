import { randomUUID } from "node:crypto";
import { parseWav, sineWav } from "@/lib/audio/wav";
import { DEFAULT_RATE } from "@/lib/estimate";
import { renderGeminiChunkText, TTS_STYLE } from "@/lib/pipeline/chunker";
import { NO_USAGE } from "@/lib/pricing";
import type { TtsProvider, TtsRequest, TtsResult, VoiceDesigner } from "./provider";

/** Jobs batch factices, gardés en mémoire du process. */
const jobs = new Map<string, { reqs: TtsRequest[]; polls: number }>();

function synthesize(req: TtsRequest): TtsResult {
  const spoken = req.text.replace(/<[^>]+>/g, "").trim();
  const rate = req.style === TTS_STYLE.soft ? DEFAULT_RATE.soft : DEFAULT_RATE.whisper;
  const wav = sineWav(Math.max(300, Math.round((spoken.length / rate) * 1000)), {
    frequency: req.style === TTS_STYLE.soft ? 196 : 220,
  });
  const info = parseWav(wav);
  return {
    key: req.key,
    wav,
    sampleRate: info.sampleRate,
    durationMs: info.durationMs,
    usage: NO_USAGE,
  };
}

/**
 * TTS factice (`AI_MODE=mock`) : sinusoïde douce de durée proportionnelle au texte, coût nul.
 * Le batch factice reste « en cours » au premier sondage, pour exercer l'attente du mode Éco.
 */
export function createMockTts(): TtsProvider {
  return {
    id: "mock",
    renderChunkText: renderGeminiChunkText,
    synthesize: async (req) => synthesize(req),

    async submitBatch(reqs) {
      const jobId = `mock-batch-${randomUUID()}`;
      jobs.set(jobId, { reqs, polls: 0 });
      return { jobId };
    },

    async pollBatch(jobId, onResult) {
      const job = jobs.get(jobId);
      if (!job) return { state: "failed", error: "Job batch factice inconnu (process redémarré)." };
      if (job.polls++ === 0) return { state: "running" };
      for (const req of job.reqs) await onResult(synthesize(req));
      jobs.delete(jobId);
      return { state: "done", failed: 0 };
    },

    async cancelBatch(jobId) {
      jobs.delete(jobId);
    },
  };
}

export function createMockVoiceDesigner(): VoiceDesigner {
  return {
    async design() {
      return { providerVoiceId: `mock_voice_${randomUUID()}`, sampleWav: sineWav(2500) };
    },
    async replicate() {
      return { providerVoiceId: `mock_voice_${randomUUID()}`, sampleWav: sineWav(2500) };
    },
    async remove() {},
  };
}
