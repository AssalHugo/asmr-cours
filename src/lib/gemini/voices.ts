import "server-only";
import { withRetry } from "@/lib/retry";
import { gemini } from "./client";
import { toWav } from "./tts";

export type DesignedVoice = { providerVoiceId: string; sampleWav: Buffer | null };

/**
 * Voice design : crée une voix persistante à partir d'une description.
 * Limites Gemini : 200 voix stockées par projet, suppression après 1 an sans usage.
 */
export async function designVoice(input: {
  description: string;
  label: string;
  model: string;
}): Promise<DesignedVoice> {
  const voice = await withRetry(() =>
    gemini().voices.create({
      store: true,
      voice: {
        type: "prompted",
        display_name: input.label,
        language_code: "fr-FR",
        model: input.model,
        prompted: { input: input.description },
      },
    }),
  );
  if (!voice.id) throw new Error("Gemini n'a pas renvoyé d'identifiant de voix.");
  const sample = voice.sample_audio;
  return {
    providerVoiceId: voice.id,
    sampleWav: sample?.data ? toWav(Buffer.from(sample.data, "base64"), sample.mime_type) : null,
  };
}

/**
 * Voice replication (P2) : uniquement la propre voix de l'utilisatrice, avec l'audio de
 * consentement exigé par Gemini. Les deux enregistrements sont des WAV.
 */
export async function replicateVoice(input: {
  label: string;
  model: string;
  sourceWav: Buffer;
  consentWav: Buffer;
}): Promise<DesignedVoice> {
  const voice = await gemini().voices.create({
    store: true,
    voice: {
      type: "replicated",
      display_name: input.label,
      language_code: "fr-FR",
      model: input.model,
      replicated: {
        source_audio: { data: input.sourceWav.toString("base64"), mime_type: "audio/wav" },
        consent_audio: { data: input.consentWav.toString("base64"), mime_type: "audio/wav" },
      },
    },
  });
  if (!voice.id) throw new Error("Gemini n'a pas renvoyé d'identifiant de voix.");
  return { providerVoiceId: voice.id, sampleWav: null };
}

export async function deleteVoice(providerVoiceId: string): Promise<void> {
  await gemini().voices.delete(providerVoiceId);
}
