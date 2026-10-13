import "server-only";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { parseWav } from "@/lib/audio/wav";
import type { BillableUsage } from "@/lib/pricing";
import { gemini } from "./client";
import { toWav, type SpeechRequest } from "./tts";
import { batchAudioUsage } from "./usage";

/**
 * TTS par Batch API (−50 %, délai non garanti).
 *
 * Le Batch API parle le format generateContent, pas Interactions : la voix passe par
 * `speechConfig.voiceConfig`, mais le style par tour (`speech_metadata`) n'y est PAS
 * exprimable. En mode Éco, le timbre repose donc sur la voix designée seule (§8.5).
 * Entrée et sortie passent par des fichiers JSONL : une heure d'audio en réponses
 * inline ne tiendrait pas en mémoire.
 */

export type BatchState = "running" | "done" | "failed";
export type BatchItem = SpeechRequest & { key: string };
export type BatchAudio = {
  key: string;
  wav: Buffer;
  sampleRate: number;
  durationMs: number;
  usage: BillableUsage;
};

const PREBUILT_VOICE = /^[A-Z][a-z]+$/;

function voiceConfig(voiceId: string) {
  return PREBUILT_VOICE.test(voiceId)
    ? { prebuiltVoiceConfig: { voiceName: voiceId } }
    : { voice: voiceId };
}

export function batchRequestLine(item: BatchItem): string {
  return JSON.stringify({
    key: item.key,
    request: {
      contents: [{ role: "user", parts: [{ text: item.text }] }],
      generation_config: {
        response_modalities: ["AUDIO"],
        speech_config: { voice_config: toSnake(voiceConfig(item.voiceId)) },
      },
    },
  });
}

function toSnake(config: ReturnType<typeof voiceConfig>) {
  return "voice" in config
    ? { voice: config.voice }
    : { prebuilt_voice_config: { voice_name: config.prebuiltVoiceConfig.voiceName } };
}

/** Soumet tous les chunks en un seul job. La création n'est PAS idempotente : persister l'id aussitôt. */
export async function submitSpeechBatch(model: string, items: BatchItem[], label: string) {
  const ai = gemini();
  const dir = await mkdtemp(join(tmpdir(), "murmure-batch-"));
  try {
    const path = join(dir, "requests.jsonl");
    await writeFile(path, items.map(batchRequestLine).join("\n") + "\n");
    const input = await ai.files.upload({
      file: path,
      config: { displayName: `${label}-requests`, mimeType: "jsonl" },
    });
    if (!input.name) throw new Error("Le fichier de requêtes batch n'a pas été accepté.");
    const job = await ai.batches.create({
      model,
      src: input.name,
      config: { displayName: label },
    });
    if (!job.name) throw new Error("Le job batch n'a pas été créé.");
    return { jobId: job.name };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const RUNNING = new Set([
  "JOB_STATE_UNSPECIFIED",
  "JOB_STATE_QUEUED",
  "JOB_STATE_PENDING",
  "JOB_STATE_RUNNING",
  "JOB_STATE_CANCELLING",
]);

export async function getSpeechBatch(jobId: string) {
  const job = await gemini().batches.get({ name: jobId });
  const state: BatchState =
    job.state === "JOB_STATE_SUCCEEDED"
      ? "done"
      : RUNNING.has(job.state ?? "")
        ? "running"
        : "failed";
  return { state, resultFile: job.dest?.fileName, error: job.error?.message };
}

export async function cancelSpeechBatch(jobId: string) {
  await gemini().batches.cancel({ name: jobId });
}

const ResultLine = z.object({
  key: z.string(),
  response: z
    .object({
      candidates: z
        .array(
          z.object({
            content: z
              .object({
                parts: z.array(
                  z.object({
                    inlineData: z
                      .object({ data: z.string(), mimeType: z.string().optional() })
                      .optional(),
                  }),
                ),
              })
              .optional(),
          }),
        )
        .optional(),
      usageMetadata: z
        .object({
          promptTokenCount: z.number().optional(),
          candidatesTokenCount: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  error: z.unknown().optional(),
});

/** Décode une ligne du fichier de résultats. `null` si la requête a échoué. */
export function parseBatchResultLine(line: string): BatchAudio | null {
  const parsed = ResultLine.safeParse(JSON.parse(line));
  if (!parsed.success) return null;
  const { key, response } = parsed.data;
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.find((p) => p.inlineData)?.inlineData;
  if (!audio) return null;
  const wav = toWav(Buffer.from(audio.data, "base64"), audio.mimeType);
  const info = parseWav(wav);
  return {
    key,
    wav,
    sampleRate: info.sampleRate,
    durationMs: info.durationMs,
    usage: batchAudioUsage(response?.usageMetadata, info.durationMs / 1000),
  };
}

/** Télécharge le fichier de résultats et le parcourt ligne à ligne, sans tout charger. */
export async function readSpeechBatchResults(
  resultFile: string,
  onResult: (audio: BatchAudio) => Promise<void>,
): Promise<{ succeeded: number; failed: number }> {
  const dir = await mkdtemp(join(tmpdir(), "murmure-batch-"));
  let succeeded = 0;
  let failed = 0;
  try {
    const path = join(dir, "results.jsonl");
    await gemini().files.download({ file: resultFile, downloadPath: path });
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === "") continue;
      const audio = parseBatchResultLine(line);
      if (audio) {
        await onResult(audio);
        succeeded++;
      } else {
        failed++;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { succeeded, failed };
}
