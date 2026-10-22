import { schemaTask } from "@trigger.dev/sdk";
import { RemixPayload } from "@/lib/pipeline/schemas";
import {
  advanceQueueAfterFailure,
  catchPipelineError,
  courseQueue,
  PIPELINE_MACHINE,
  RETRY,
  thenAdvanceQueue,
  triggerDeps,
} from "./shared";
import { failCourse, remixCourse } from "./steps/orchestrate";

/** Nouveau pré-mix avec une autre ambiance : FFmpeg seul, aucun coût IA. */
export const remixTask = schemaTask({
  id: "remix",
  schema: RemixPayload,
  queue: courseQueue,
  machine: PIPELINE_MACHINE,
  maxDuration: 1800,
  retry: RETRY,
  run: (payload) => thenAdvanceQueue(payload, () => remixCourse(triggerDeps(), payload)),
  catchError: catchPipelineError,
  onFailure: async ({ payload, error }) => {
    await failCourse(triggerDeps(), payload.courseId, payload.userId, error, { keepReady: true });
    await advanceQueueAfterFailure(payload);
  },
});
