import "server-only";
import { aiProviders } from "@/lib/ai";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PipelineDeps } from "@/trigger/steps/context";
import { createSupabaseRepo } from "./supabase-repo";
import { withWorkdir } from "./workdir";

/** Dépendances réelles du pipeline. `wait` et `report` dépendent de l'hôte (Trigger.dev ou inline). */
export function createPipelineDeps(host: Pick<PipelineDeps, "wait" | "report">): PipelineDeps {
  const e = env();
  const ai = aiProviders();
  return {
    repo: createSupabaseRepo(createAdminClient()),
    storage: storage(),
    ai,
    appEnv: e.APP_ENV,
    limits: {
      ttsConcurrency: e.TTS_STANDARD_CONCURRENCY,
      maxSourceChars: e.MAX_SOURCE_CHARS,
      globalBudgetUsd: e.GLOBAL_MONTHLY_BUDGET_USD,
    },
    now: () => new Date(),
    workdir: withWorkdir,
    // Le batch factice répond au deuxième sondage : inutile de patienter 3 min en mock.
    batchPollSeconds: ai.mock ? 2 : 180,
    batchTimeoutMs: 24 * 60 * 60 * 1000,
    ...host,
  };
}
