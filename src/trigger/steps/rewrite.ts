import {
  passageContext,
  reexplainProblems,
  splicePassage,
  type PassageRange,
} from "@/lib/pipeline/passage";
import {
  Script,
  scriptProblems,
  reportIsClean,
  type ExtractedSection,
  type Script as ScriptType,
} from "@/lib/pipeline/schemas";
import type { SectionRow } from "@/lib/pipeline/repo";
import type { RewriteContext, RewriteFeedback } from "@/lib/prompts/rewrite";
import { mapLimit, withRetry } from "@/lib/retry";
import { billed, recordUsage, setStatus, type Ctx } from "./context";

/** Sections réécrites ou vérifiées en parallèle. */
const PARALLEL_SECTIONS = 3;
/** Relances de réécriture après un contrôle de fidélité négatif (§8.3). */
export const MAX_FIDELITY_REWRITES = 2;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function toSource(row: SectionRow): ExtractedSection {
  return {
    title: row.title,
    content: row.source_text,
    keyTerms: stringList(row.key_terms),
    keyFacts: stringList(row.key_facts),
  };
}

function rewriteContext(ctx: Ctx, row: SectionRow, count: number): RewriteContext {
  return {
    mode: ctx.course.mode,
    addressForm: ctx.course.address_form === "vous" ? "vous" : "tu",
    isFirst: row.idx === 0,
    isLast: row.idx === count - 1,
    quizAfter: ctx.course.quiz,
  };
}

/** Retire ce que le TTS lirait mot à mot si le modèle a ignoré la consigne. */
export function sanitizeScript(script: ScriptType): ScriptType {
  const segments = script.segments
    .map((s) => ({
      ...s,
      text: s.text
        .replace(/[*_#`~|[\]<>{}]/g, " ")
        .replace(/\p{Extended_Pictographic}/gu, "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((s) => s.text.length > 0);
  return { segments: segments.length > 0 ? segments : script.segments };
}

/** Une réécriture, relancée si la sortie sort du schéma (segment trop long, pause hors bornes…). */
async function rewriteOnce(
  ctx: Ctx,
  row: SectionRow,
  count: number,
  feedback?: RewriteFeedback,
): Promise<ScriptType> {
  const result = await withRetry(
    () =>
      billed(ctx, "rewrite", () =>
        ctx.deps.ai.llm.rewrite({
          section: toSource(row),
          ctx: rewriteContext(ctx, row, count),
          feedback,
        }),
      ),
    { shouldRetry: (e) => e instanceof Error && e.name === "LlmOutputError", baseMs: 200 },
  );
  await recordUsage(ctx, "rewrite", result.model, "standard", result.usage);
  return result.data;
}

/** §8.2 — Réécriture ASMR des sections sans script. */
export async function rewriteStep(ctx: Ctx): Promise<void> {
  const { repo } = ctx.deps;
  const sections = await repo.listSections(ctx.course.id);
  const todo = sections.filter((s) => s.script === null);
  if (todo.length === 0) return;

  await setStatus(ctx, "rewriting");
  let done = 0;
  await mapLimit(todo, PARALLEL_SECTIONS, async (row) => {
    await rewriteSection(ctx, row, sections.length);
    await setStatus(ctx, "rewriting", ++done / todo.length);
  });
}

/**
 * Réécrit une section et remplace son script d'un seul coup : tant que la réécriture n'a pas
 * abouti, l'ancien script reste en place.
 */
export async function rewriteSection(ctx: Ctx, row: SectionRow, count: number): Promise<void> {
  let script = await rewriteOnce(ctx, row, count);
  const problems = scriptProblems(script, row.source_text.length);
  // Contrôle de forme côté code : une seule relance.
  if (problems.length > 0) script = await rewriteOnce(ctx, row, count, { problems });
  await ctx.deps.repo.updateSection(row.id, {
    script: sanitizeScript(script),
    verified: false,
    verify_report: null,
  });
}

/** §8.3 — Contrôle de fidélité des sections sans rapport, avec relances de réécriture. */
export async function verifyStep(ctx: Ctx): Promise<void> {
  const { repo, ai } = ctx.deps;
  const sections = await repo.listSections(ctx.course.id);
  const todo = sections.filter((s) => s.script !== null && s.verify_report === null);
  if (todo.length === 0) return;

  await setStatus(ctx, "verifying");
  let done = 0;
  await mapLimit(todo, PARALLEL_SECTIONS, async (row) => {
    let script = Script.parse(row.script);
    for (let rewrites = 0; ; rewrites++) {
      const verdict = await billed(ctx, "verify", () => ai.llm.verify(toSource(row), script));
      await recordUsage(ctx, "verify", verdict.model, "standard", verdict.usage);
      const formWarnings = scriptProblems(script, row.source_text.length);
      const clean = reportIsClean(verdict.data);
      if (clean || rewrites >= MAX_FIDELITY_REWRITES) {
        // Après 2 relances, on continue avec `verified=false` : l'alerte est visible dans l'UI.
        await repo.updateSection(row.id, {
          script,
          verified: clean,
          verify_report: {
            ...verdict.data,
            ok: clean,
            ...(formWarnings.length ? { formWarnings } : {}),
          },
        });
        break;
      }
      script = sanitizeScript(
        await rewriteOnce(ctx, row, sections.length, {
          report: verdict.data,
          problems: formWarnings,
        }),
      );
      await repo.updateSection(row.id, { script });
    }
    await setStatus(ctx, "verifying", ++done / todo.length);
  });
}

/**
 * « Réexplique-moi autrement » : réécrit un seul passage d'une section, plus simplement et
 * avec un exemple, et l'insère à la place de l'original. Le rapport de fidélité de la section
 * est gardé : le contrôle complet relancerait la réécriture de toute la section.
 */
export async function reexplainPassage(
  ctx: Ctx,
  row: SectionRow,
  range: PassageRange,
): Promise<void> {
  const segments = Script.parse(row.script).segments;
  const around = passageContext(segments, range);
  const once = async (problems?: string[]) => {
    const result = await withRetry(
      () =>
        billed(ctx, "reexplain", () =>
          ctx.deps.ai.llm.reexplain({
            section: toSource(row),
            ...around,
            ctx: {
              mode: ctx.course.mode,
              addressForm: ctx.course.address_form === "vous" ? "vous" : "tu",
            },
            problems,
          }),
        ),
      { shouldRetry: (e) => e instanceof Error && e.name === "LlmOutputError", baseMs: 200 },
    );
    await recordUsage(ctx, "reexplain", result.model, "standard", result.usage);
    return result.data;
  };

  let script = await once();
  const problems = reexplainProblems(around.passage, script);
  // Contrôle de forme côté code : une seule relance, comme pour une section.
  if (problems.length > 0) script = await once(problems);
  await ctx.deps.repo.updateSection(row.id, {
    script: { segments: splicePassage(segments, range, sanitizeScript(script).segments) },
  });
}
