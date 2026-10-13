import "server-only";
import {
  cancelSpeechBatch,
  getSpeechBatch,
  readSpeechBatchResults,
  submitSpeechBatch,
} from "@/lib/gemini/batch";
import { synthesizeSpeech } from "@/lib/gemini/tts";
import { deleteVoice, designVoice, replicateVoice } from "@/lib/gemini/voices";
import { renderGeminiChunkText } from "@/lib/pipeline/chunker";
import type { TtsProvider, VoiceDesigner } from "./provider";

export function createGeminiTts(): TtsProvider {
  return {
    id: "gemini",
    renderChunkText: renderGeminiChunkText,

    async synthesize(req) {
      return { key: req.key, ...(await synthesizeSpeech(req)) };
    },

    async submitBatch(reqs, label) {
      const model = reqs[0]?.model;
      if (!model) throw new Error("Batch TTS vide.");
      return submitSpeechBatch(model, reqs, label);
    },

    async pollBatch(jobId, onResult) {
      const job = await getSpeechBatch(jobId);
      if (job.state === "running") return { state: "running" };
      if (job.state === "failed" || !job.resultFile) {
        return { state: "failed", error: job.error ?? "Le job batch a échoué ou a expiré." };
      }
      const { failed } = await readSpeechBatchResults(job.resultFile, onResult);
      return { state: "done", failed };
    },

    cancelBatch: cancelSpeechBatch,
  };
}

export function createGeminiVoiceDesigner(): VoiceDesigner {
  return { design: designVoice, replicate: replicateVoice, remove: deleteVoice };
}
