import { schemaTask } from "@trigger.dev/sdk";
import { RedoChunkPayload } from "@/lib/pipeline/schemas";
import {
  advanceQueueAfterFailure,
  catchPipelineError,
  courseQueue,
  PIPELINE_MACHINE,
  RETRY,
  thenAdvanceQueue,
  triggerDeps,
} from "./shared";
import { failCourse, redoChunk } from "./steps/orchestrate";

/** Réenregistre un seul passage, puis réassemble. Seul ce passage est payé. */
export const redoChunkTask = schemaTask({
  id: "redo-chunk",
  schema: RedoChunkPayload,
  queue: courseQueue,
  machine: PIPELINE_MACHINE,
  maxDuration: 1800,
  retry: RETRY,
  run: (payload) => thenAdvanceQueue(payload, () => redoChunk(triggerDeps(), payload)),
  catchError: catchPipelineError,
  onFailure: async ({ payload, error }) => {
    await failCourse(triggerDeps(), payload.courseId, payload.userId, error);
    await advanceQueueAfterFailure(payload);
  },
});
