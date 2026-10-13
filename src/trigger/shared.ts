import { metadata, queue, wait } from "@trigger.dev/sdk";
import { createPipelineDeps } from "@/lib/pipeline/runtime";
import type { RunProgress } from "@/lib/pipeline/status";
import { PipelineError } from "./steps/context";

/**
 * Une seule file, limite 1 : avec `concurrencyKey = userId` au déclenchement,
 * chaque utilisatrice n'a qu'une génération en cours à la fois.
 */
export const courseQueue = queue({ name: "course-generation", concurrencyLimit: 1 });

/** 3 essais, backoff exponentiel avec jitter (§8.0). */
export const RETRY = {
  maxAttempts: 3,
  factor: 2,
  minTimeoutInMs: 5_000,
  maxTimeoutInMs: 120_000,
  randomize: true,
} as const;

/**
 * Machine du pipeline. Mesure du 2026-10-13 (scripts/bench-pipeline.ts, 81 min d'audio,
 * 448 chunks) : 139 Mo de mémoire au pic, 1,2 Go de disque temporaire, 150 s sur un cœur
 * rapide dont 142 s de mastering mono-thread. `small-2x` (1 vCPU, 1 Go) est la plus petite
 * machine qui garde de la marge mémoire ; `small-1x` (0,5 Go) serait trop juste.
 */
export const PIPELINE_MACHINE = "small-2x" as const;

function report(progress: RunProgress) {
  metadata
    .set("status", progress.status)
    .set("progress", progress.progress)
    .set("costUsd", progress.costUsd)
    .set("durationMs", progress.durationMs);
  if (progress.error) metadata.set("error", progress.error);
}

/** Dépendances du pipeline sous Trigger.dev : attente checkpointée, avancement dans la metadata. */
export function triggerDeps() {
  return createPipelineDeps({
    // Au-delà de quelques secondes le run est checkpointé : l'attente n'est pas facturée.
    wait: async (seconds) => {
      await wait.for({ seconds });
    },
    report,
  });
}

/** Une erreur destinée à l'utilisatrice ne se résout pas en réessayant. */
export function catchPipelineError({ error }: { error: unknown }) {
  if (error instanceof PipelineError) return { skipRetrying: true };
  return undefined;
}
