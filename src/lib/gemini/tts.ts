import "server-only";
import { parseWav, pcm16ToWav } from "@/lib/audio/wav";
import type { BillableUsage } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini } from "./client";
import { audioUsage } from "./usage";

export type SpeechRequest = { model: string; text: string; voiceId: string; style: string };
export type SpeechResult = {
  wav: Buffer;
  sampleRate: number;
  durationMs: number;
  usage: BillableUsage;
};

const DEFAULT_SAMPLE_RATE = 24_000;
/**
 * Langue de la synthèse. Sans elle, Gemini la devine d'après le texte : une voix
 * prédéfinie, multilingue, peut alors prendre un accent sur un passage ambigu.
 */
export const SPEECH_LANGUAGE = "fr-FR";

/** Ramène l'audio Gemini à un WAV : le PCM brut (audio/l16) reçoit un en-tête RIFF. */
export function toWav(data: Buffer, mimeType: string | undefined): Buffer {
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF") return data;
  const type = (mimeType ?? "").toLowerCase();
  if (type === "" || type.startsWith("audio/l16") || type.startsWith("audio/pcm")) {
    const rate = /rate=(\d+)/.exec(type)?.[1];
    return pcm16ToWav(data, rate ? Number(rate) : DEFAULT_SAMPLE_RATE);
  }
  throw new Error(`Format audio inattendu de Gemini : ${mimeType}`);
}

/**
 * Synthèse unaire (Interactions API). Le texte est lu mot à mot ; le style voyage dans
 * l'annotation `speech_metadata`, jamais dans le texte. Un style vide (cours Éco) n'envoie
 * aucune annotation. Sortie : WAV 24 kHz mono 16 bits.
 */
export async function synthesizeSpeech(req: SpeechRequest): Promise<SpeechResult> {
  const interaction = await withRetry(
    () =>
      gemini().interactions.create(
        {
          model: req.model,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text: req.text,
                  ...(req.style
                    ? { annotations: [{ type: "speech_metadata" as const, style: req.style }] }
                    : {}),
                },
              ],
            },
          ],
          response_format: {
            type: "audio",
            mime_type: "audio/wav",
            sample_rate: DEFAULT_SAMPLE_RATE,
          },
          generation_config: {
            speech_config: [{ voice: req.voiceId, language: SPEECH_LANGUAGE }],
          },
          store: false,
        },
        { retries: { strategy: "none" } },
      ),
    { label: req.model },
  );
  const audio = interaction.output_audio;
  if (interaction.status !== "completed" || !audio?.data) {
    throw new Error(`Synthèse ${req.model} sans audio (statut ${interaction.status}).`);
  }
  const wav = toWav(Buffer.from(audio.data, "base64"), audio.mime_type);
  const info = parseWav(wav);
  return {
    wav,
    sampleRate: info.sampleRate,
    durationMs: info.durationMs,
    usage: audioUsage(interaction.usage, info.durationMs / 1000),
  };
}
