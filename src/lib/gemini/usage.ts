import type { BillableUsage } from "@/lib/pricing";

type InteractionUsage = {
  total_input_tokens?: number | undefined;
  total_output_tokens?: number | undefined;
  total_thought_tokens?: number | undefined;
};

/** Usage d'une interaction texte. Le thinking est compté à part, puis facturé comme de la sortie. */
export function textUsage(usage: InteractionUsage | undefined): BillableUsage {
  return {
    inputTokens: usage?.total_input_tokens ?? 0,
    outputTokens: usage?.total_output_tokens ?? 0,
    thinkingTokens: usage?.total_thought_tokens ?? 0,
    audioSeconds: 0,
  };
}

/** Usage d'un appel TTS : la sortie est mesurée en secondes d'audio réellement reçues. */
export function audioUsage(
  usage: InteractionUsage | undefined,
  audioSeconds: number,
): BillableUsage {
  return {
    inputTokens: usage?.total_input_tokens ?? 0,
    outputTokens: usage?.total_output_tokens ?? 0,
    thinkingTokens: 0,
    audioSeconds,
  };
}

/** Usage au format generateContent (réponses du Batch API). */
export function batchAudioUsage(
  usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined,
  audioSeconds: number,
): BillableUsage {
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    thinkingTokens: 0,
    audioSeconds,
  };
}
