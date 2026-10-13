import { schemaTask } from "@trigger.dev/sdk";
import { VoiceSamplePayload } from "@/lib/pipeline/schemas";
import { catchPipelineError, RETRY, triggerDeps } from "./shared";
import { voiceSample } from "./steps/orchestrate";

/** Échantillon d'aperçu d'une voix, mis en cache par voix × mode. */
export const voiceSampleTask = schemaTask({
  id: "voice-sample",
  schema: VoiceSamplePayload,
  machine: "micro",
  maxDuration: 300,
  retry: RETRY,
  run: (payload) => voiceSample(triggerDeps(), payload),
  catchError: catchPipelineError,
});
