import { schemaTask } from "@trigger.dev/sdk";
import { ReexplainChunkPayload } from "@/lib/pipeline/schemas";
import {
  advanceQueueAfterFailure,
  catchPipelineError,
  courseQueue,
  PIPELINE_MACHINE,
  RETRY,
  thenAdvanceQueue,
  triggerDeps,
} from "./shared";
import { failCourse, reexplainChunk } from "./steps/orchestrate";

/** Réécrit un seul passage plus simplement, avec un exemple, puis le réenregistre et réassemble. */
export const reexplainChunkTask = schemaTask({
  id: "reexplain-chunk",
  schema: ReexplainChunkPayload,
  queue: courseQueue,
  machine: PIPELINE_MACHINE,
  maxDuration: 1800,
  retry: RETRY,
  run: (payload) => thenAdvanceQueue(payload, () => reexplainChunk(triggerDeps(), payload)),
  catchError: catchPipelineError,
  onFailure: async ({ payload, error }) => {
    await failCourse(triggerDeps(), payload.courseId, payload.userId, error);
    await advanceQueueAfterFailure(payload);
  },
});
