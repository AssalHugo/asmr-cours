import "server-only";
import { runs, tasks } from "@trigger.dev/sdk";
import { env, triggerEnv } from "@/lib/env";
import { createPipelineDeps } from "@/lib/pipeline/runtime";
import type {
  GenerateCoursePayload,
  RegenerateSectionPayload,
  RemixPayload,
  VoiceSamplePayload,
} from "@/lib/pipeline/schemas";
import type { generateCourseTask } from "@/trigger/generate-course";
import type { regenerateSectionTask } from "@/trigger/regenerate-section";
import type { remixTask } from "@/trigger/remix";
import {
  failCourse,
  generateCourse,
  regenerateSection,
  remixCourse,
  voiceSample,
} from "@/trigger/steps/orchestrate";
import type { voiceSampleTask } from "@/trigger/voice-sample";

export type Job =
  | { kind: "generate-course"; payload: GenerateCoursePayload }
  | { kind: "regenerate-section"; payload: RegenerateSectionPayload }
  | { kind: "remix"; payload: RemixPayload };

/** Files d'attente du mode inline : une génération à la fois par utilisatrice, comme sous Trigger.dev. */
const globalQueues = globalThis as { __murmureInlineQueues?: Map<string, Promise<void>> };
const inlineQueues = (globalQueues.__murmureInlineQueues ??= new Map());

const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

async function runInline(job: Job): Promise<void> {
  const deps = createPipelineDeps({ wait: sleep });
  try {
    if (job.kind === "generate-course") await generateCourse(deps, job.payload);
    else if (job.kind === "regenerate-section") await regenerateSection(deps, job.payload);
    else await remixCourse(deps, job.payload);
  } catch (error) {
    console.error(`[murmure] ${job.kind} en échec`, error);
    await failCourse(deps, job.payload.courseId, job.payload.userId, error).catch(() => undefined);
  }
}

/**
 * Lance une tâche de cours. Sous Trigger.dev, renvoie l'identifiant du run ;
 * en mode inline (dev, E2E), la tâche tourne dans le process et l'UI suit la base.
 */
export async function startJob(job: Job): Promise<{ runId: string | null }> {
  if (env().JOBS_MODE === "inline") {
    const userId = job.payload.userId;
    const previous = inlineQueues.get(userId) ?? Promise.resolve();
    inlineQueues.set(
      userId,
      previous.then(() => runInline(job)),
    );
    return { runId: null };
  }

  triggerEnv();
  const options = { concurrencyKey: job.payload.userId };
  const handle =
    job.kind === "generate-course"
      ? await tasks.trigger<typeof generateCourseTask>("generate-course", job.payload, options)
      : job.kind === "regenerate-section"
        ? await tasks.trigger<typeof regenerateSectionTask>(
            "regenerate-section",
            job.payload,
            options,
          )
        : await tasks.trigger<typeof remixTask>("remix", job.payload, options);
  return { runId: handle.id };
}

/** Échantillon de voix : attendu directement, il ne dure que quelques secondes. */
export async function runVoiceSample(payload: VoiceSamplePayload): Promise<{ key: string }> {
  if (env().JOBS_MODE === "inline") {
    return voiceSample(createPipelineDeps({ wait: sleep }), payload);
  }
  triggerEnv();
  const handle = await tasks.trigger<typeof voiceSampleTask>("voice-sample", payload);
  const result = await runs.poll(handle, { pollIntervalMs: 1000 });
  if (!result.output) throw new Error("L'échantillon de voix n'a pas pu être généré.");
  return { key: result.output.key };
}
