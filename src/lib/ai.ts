import "server-only";
import { env } from "@/lib/env";
import type { EstimateModels } from "@/lib/estimate";
import { createGeminiLlm } from "@/lib/llm/gemini";
import { createMockLlm } from "@/lib/llm/mock";
import type { LlmProvider } from "@/lib/llm/provider";
import { MOCK_MODEL } from "@/lib/pricing";
import { createGeminiTts, createGeminiVoiceDesigner } from "@/lib/tts/gemini";
import { createMockTts, createMockVoiceDesigner } from "@/lib/tts/mock";
import type { TtsProvider, VoiceDesigner } from "@/lib/tts/provider";

export type AiProviders = {
  mock: boolean;
  llm: LlmProvider;
  tts: TtsProvider;
  voices: VoiceDesigner;
  models: EstimateModels;
};

/** Providers IA selon `AI_MODE`. En mock, tous les modèles valent « mock » (coût nul). */
export function aiProviders(): AiProviders {
  const e = env();
  if (e.AI_MODE === "mock") {
    return {
      mock: true,
      llm: createMockLlm(),
      tts: createMockTts(),
      voices: createMockVoiceDesigner(),
      models: { text: MOCK_MODEL, check: MOCK_MODEL, tts: MOCK_MODEL, ttsLite: MOCK_MODEL },
    };
  }
  return {
    mock: false,
    llm: createGeminiLlm(),
    tts: createGeminiTts(),
    voices: createGeminiVoiceDesigner(),
    models: {
      text: e.GEMINI_MODEL_TEXT,
      check: e.GEMINI_MODEL_CHECK,
      tts: e.GEMINI_MODEL_TTS,
      ttsLite: e.GEMINI_MODEL_TTS_LITE,
    },
  };
}
