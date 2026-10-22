import { schemaTask } from "@trigger.dev/sdk";
import { RegenerateSectionPayload } from "@/lib/pipeline/schemas";
import {
  advanceQueueAfterFailure,
  catchPipelineError,
  courseQueue,
  PIPELINE_MACHINE,
  RETRY,
  thenAdvanceQueue,
  triggerDeps,
} from "./shared";
import { failCourse, regenerateSection } from "./steps/orchestrate";

/** Réécrit et resynthétise une section, puis réassemble. Seuls les chunks modifiés sont payés. */
export const regenerateSectionTask = schemaTask({
  id: "regenerate-section",
  schema: RegenerateSectionPayload,
  queue: courseQueue,
  machine: PIPELINE_MACHINE,
  maxDuration: 1800,
  retry: RETRY,
  run: (payload) => thenAdvanceQueue(payload, () => regenerateSection(triggerDeps(), payload)),
  catchError: catchPipelineError,
  onFailure: async ({ payload, error }) => {
    await failCourse(triggerDeps(), payload.courseId, payload.userId, error);
    await advanceQueueAfterFailure(payload);
  },
});
