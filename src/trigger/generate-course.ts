import { schemaTask } from "@trigger.dev/sdk";
import { GenerateCoursePayload } from "@/lib/pipeline/schemas";
import { catchPipelineError, courseQueue, PIPELINE_MACHINE, RETRY, triggerDeps } from "./shared";
import { failCourse, generateCourse } from "./steps/orchestrate";

/** Génère un cours de bout en bout. Relancer la tâche reprend là où elle s'était arrêtée. */
export const generateCourseTask = schemaTask({
  id: "generate-course",
  schema: GenerateCoursePayload,
  queue: courseQueue,
  machine: PIPELINE_MACHINE,
  // Hors attentes (non comptées) : 1 h d'audio se traite en quelques minutes.
  maxDuration: 3600,
  retry: RETRY,
  run: (payload) => generateCourse(triggerDeps(), payload),
  catchError: catchPipelineError,
  onFailure: async ({ payload, error }) => {
    await failCourse(triggerDeps(), payload.courseId, payload.userId, error);
  },
});
