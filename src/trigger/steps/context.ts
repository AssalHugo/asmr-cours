import type { AiProviders } from "@/lib/ai";
import { checkBudget } from "@/lib/budget";
import { costUsd, type BillableUsage, type BillingTier } from "@/lib/pricing";
import type { CoursePatch, CourseRow, PipelineRepo } from "@/lib/pipeline/repo";
import { progressFor, type CourseStatus, type RunProgress } from "@/lib/pipeline/status";
import type { ObjectStorage } from "@/lib/storage/types";

/** Erreur dont le message est destiné à l'utilisatrice ; relancer ne la résoudrait pas. */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * Dépendances injectées dans les étapes. Les tâches Trigger.dev, le mode `inline`
 * et les tests fournissent chacun les leurs : les étapes ne connaissent ni Trigger.dev,
 * ni Supabase, ni R2.
 */
export type PipelineDeps = {
  repo: PipelineRepo;
  storage: ObjectStorage;
  ai: AiProviders;
  appEnv: "dev" | "prod";
  limits: { ttsConcurrency: number; maxSourceChars: number };
  now: () => Date;
  /** Attente longue : `wait.for` (checkpoint, non facturée) sous Trigger.dev. */
  wait: (seconds: number) => Promise<void>;
  /** Publie l'avancement hors base (metadata du run). */
  report?: (progress: RunProgress) => void;
  /** Répertoire de travail temporaire, nettoyé en sortie. */
  workdir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
  batchPollSeconds: number;
  batchTimeoutMs: number;
};

export type Ctx = {
  deps: PipelineDeps;
  userId: string;
  course: CourseRow;
  /** Audio synthétisé pendant ce run, en millisecondes. */
  producedMs: number;
  /** Synthèse en appels standard même pour un cours Éco (régénération d'une section). */
  forceStandard: boolean;
};

export async function loadCtx(
  deps: PipelineDeps,
  courseId: string,
  userId: string,
  opts: { forceStandard?: boolean } = {},
): Promise<Ctx> {
  const course = await deps.repo.getCourse(courseId, userId);
  if (!course) throw new PipelineError("Ce cours n'existe plus.");
  return { deps, userId, course, producedMs: 0, forceStandard: opts.forceStandard ?? false };
}

export async function patchCourse(ctx: Ctx, patch: CoursePatch): Promise<void> {
  await ctx.deps.repo.updateCourse(ctx.course.id, ctx.userId, patch);
  Object.assign(ctx.course, patch);
}

/** Persiste statut et avancement dans `courses`, et les publie dans la metadata du run. */
export async function setStatus(
  ctx: Ctx,
  status: CourseStatus,
  fraction = 0,
  extra: CoursePatch = {},
): Promise<void> {
  const progress = progressFor(status, fraction);
  const changed = status !== ctx.course.status || progress !== ctx.course.progress;
  if (changed || Object.keys(extra).length > 0) {
    await patchCourse(ctx, { status, progress, ...extra });
  }
  if (changed) {
    ctx.deps.report?.({
      status,
      progress,
      costUsd: await ctx.deps.repo.courseCost(ctx.course.id),
      durationMs: ctx.producedMs,
    });
  }
}

/** Journalise un appel facturable dans `usage_events`, coût calculé au tarif du jour. */
export async function recordUsage(
  ctx: Pick<Ctx, "deps" | "userId"> & { course?: Pick<CourseRow, "id"> },
  step: string,
  model: string,
  tier: BillingTier,
  usage: BillableUsage,
): Promise<number> {
  const cost = costUsd(model, tier, usage, ctx.deps.now());
  await ctx.deps.repo.insertUsage({
    userId: ctx.userId,
    courseId: ctx.course?.id ?? null,
    step,
    model,
    tier,
    usage,
    costUsd: cost,
  });
  return cost;
}

/**
 * Plafond dur du budget, contrôlé de nouveau en cours de route. La confirmation des 80 %
 * a été donnée au lancement : seul un dépassement du budget arrête le cours ici.
 */
export async function assertBudget(ctx: Ctx, estimateUsd: number): Promise<void> {
  const { repo, now } = ctx.deps;
  const [profile, spentUsd] = await Promise.all([
    repo.getProfile(ctx.userId),
    repo.monthlySpend(ctx.userId, now()),
  ]);
  const decision = checkBudget({
    spentUsd,
    estimateUsd,
    budgetUsd: profile?.monthly_budget_usd ?? 0,
    tier: "eco",
    confirmed: true,
  });
  if (!decision.ok) throw new PipelineError(decision.message);
}

/** Message affiché à l'utilisatrice quand un cours échoue. */
export function userMessage(error: unknown): string {
  if (error instanceof PipelineError) return error.message;
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (status === 429) {
    return "Gemini limite le débit pour l'instant. Reprends dans quelques minutes.";
  }
  if (error instanceof Error && error.name === "MissingEnvError") return error.message;
  return "La génération s'est interrompue. Tu peux la reprendre : ce qui est déjà fait est conservé.";
}
