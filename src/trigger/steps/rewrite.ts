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
import { recordUsage, setStatus, type Ctx } from "./context";

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
      ctx.deps.ai.llm.rewrite({
        section: toSource(row),
        ctx: rewriteContext(ctx, row, count),
        feedback,
      }),
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
    let script = await rewriteOnce(ctx, row, sections.length);
    const problems = scriptProblems(script, row.source_text.length);
    // Contrôle de forme côté code : une seule relance.
    if (problems.length > 0) script = await rewriteOnce(ctx, row, sections.length, { problems });
    await repo.updateSection(row.id, {
      script: sanitizeScript(script),
      verified: false,
      verify_report: null,
    });
    await setStatus(ctx, "rewriting", ++done / todo.length);
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
      const verdict = await ai.llm.verify(toSource(row), script);
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
