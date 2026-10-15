import { Quiz, quizProblems, type Quiz as QuizType } from "@/lib/pipeline/schemas";
import type { SectionRow } from "@/lib/pipeline/repo";
import { mapLimit, withRetry } from "@/lib/retry";
import { billed, recordUsage, setStatus, type Ctx } from "./context";
import { toSource } from "./rewrite";

/** Quiz écrits en parallèle, comme les réécritures. */
const PARALLEL_SECTIONS = 3;

/** Retire ce que le TTS lirait mot à mot si le modèle a ignoré la consigne. */
export function sanitizeQuiz(quiz: QuizType): QuizType {
  const clean = (text: string) =>
    text
      .replace(/[*_#`~|[\]<>{}]/g, " ")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const items = quiz.items
    .map((item) => ({ question: clean(item.question), answer: clean(item.answer) }))
    .filter((item) => item.question.length > 0 && item.answer.length > 0);
  return Quiz.safeParse({ items }).success ? { items } : quiz;
}

/** Quiz d'une section, s'il est prêt. */
export function sectionQuiz(row: Pick<SectionRow, "quiz">): QuizType | null {
  const parsed = Quiz.safeParse(row.quiz);
  return parsed.success ? parsed.data : null;
}

async function writeQuiz(ctx: Ctx, row: SectionRow): Promise<void> {
  const once = async (problems?: string[]) => {
    const result = await withRetry(
      () =>
        billed(ctx, "quiz", () =>
          ctx.deps.ai.llm.quiz({
            section: toSource(row),
            ctx: {
              mode: ctx.course.mode,
              addressForm: ctx.course.address_form === "vous" ? "vous" : "tu",
            },
            problems,
          }),
        ),
      { shouldRetry: (e) => e instanceof Error && e.name === "LlmOutputError", baseMs: 200 },
    );
    await recordUsage(ctx, "quiz", result.model, "standard", result.usage);
    return result.data;
  };

  let quiz = await once();
  const problems = quizProblems(quiz);
  // Contrôle de forme côté code : une seule relance, comme pour un script.
  if (problems.length > 0) quiz = await once(problems);
  await ctx.deps.repo.updateSection(row.id, { quiz: sanitizeQuiz(quiz) });
}

/**
 * Quiz de fin de chapitre, après la réécriture : 2 ou 3 questions par section, écrites d'après
 * sa source. Ne dépend pas du script : une réécriture ou un passage réexpliqué le gardent.
 * Sauté pour un cours sans quiz (choix « pour s'endormir » au lancement).
 */
export async function quizStep(ctx: Ctx): Promise<void> {
  if (!ctx.course.quiz) return;
  const sections = await ctx.deps.repo.listSections(ctx.course.id);
  const todo = sections.filter((s) => sectionQuiz(s) === null);
  if (todo.length === 0) return;

  await setStatus(ctx, "rewriting", 1);
  await mapLimit(todo, PARALLEL_SECTIONS, (row) => writeQuiz(ctx, row));
}
