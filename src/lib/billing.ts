import { env } from "@/lib/env";
import type { EstimateModels } from "@/lib/estimate";
import { MOCK_MODEL } from "@/lib/pricing";

/** Modèles facturés : « mock » partout en mode mock, pour une estimation à zéro. */
export function billingModels(): { models: EstimateModels; mock: boolean } {
  const e = env();
  const mock = e.AI_MODE === "mock";
  return {
    mock,
    models: mock
      ? { text: MOCK_MODEL, check: MOCK_MODEL, tts: MOCK_MODEL, ttsLite: MOCK_MODEL }
      : {
          text: e.GEMINI_MODEL_TEXT,
          check: e.GEMINI_MODEL_CHECK,
          tts: e.GEMINI_MODEL_TTS,
          ttsLite: e.GEMINI_MODEL_TTS_LITE,
        },
  };
}
