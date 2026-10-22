import {
  effectiveRange,
  rangeChars,
  withLastPages,
  type LessonDraft,
  type LessonLimits,
} from "./detect";

/** Ce qu'il faut savoir d'un classeur pour mesurer ses leçons. */
export type BinderShape = { pages: number; pageChars: number[]; scanned: boolean };

export type PlannedLesson = LessonDraft & {
  idx: number;
  lastPage: number;
  /** Pages envoyées, sans les pages vides en bordure ; `null` si la leçon est vide. */
  range: { firstPage: number; lastPage: number } | null;
  pages: number;
  chars: number;
  /** Raison pour laquelle cette leçon ne peut pas être générée telle quelle. */
  problem: string | null;
};

/** Les leçons doivent couvrir le document d'un seul tenant, de la page 1 à la dernière. */
export function partitionError(lessons: { firstPage: number }[], pages: number): string | null {
  if (lessons.length === 0) return "Ce classeur n'a plus de leçon.";
  if (lessons[0]?.firstPage !== 1) return "La première leçon doit commencer à la page 1.";
  for (let i = 1; i < lessons.length; i++) {
    const page = lessons[i]?.firstPage ?? 0;
    if (page <= (lessons[i - 1]?.firstPage ?? 0) || page > pages) {
      return `La leçon ${i + 1} doit commencer après la précédente, et au plus tard page ${pages}.`;
    }
  }
  return null;
}

/** Mesure chaque leçon : pages réellement envoyées, taille, et ce qui l'empêcherait d'être générée. */
export function planLessons(
  lessons: LessonDraft[],
  binder: BinderShape,
  limits: LessonLimits,
): PlannedLesson[] {
  return withLastPages(lessons, binder.pages).map((lesson, idx) => {
    const range = effectiveRange(
      lesson.firstPage,
      lesson.lastPage,
      binder.pageChars,
      binder.scanned,
    );
    const pages = range ? range.lastPage - range.firstPage + 1 : 0;
    const chars = range ? rangeChars(range.firstPage, range.lastPage, binder.pageChars) : 0;
    const problem = !range
      ? "Ces pages sont vides."
      : pages > limits.maxPages
        ? `${pages} pages : ${limits.maxPages} au plus par leçon. Coupe-la en deux.`
        : chars > limits.maxChars
          ? "Trop de texte pour un seul cours. Coupe-la en deux."
          : null;
    return { ...lesson, idx, lastPage: lesson.lastPage, range, pages, chars, problem };
  });
}

/** Coupe une leçon en deux au milieu de ses pages. */
export function splitLesson(lessons: LessonDraft[], index: number, pages: number): LessonDraft[] {
  const [lesson] = withLastPages(lessons, pages).slice(index, index + 1);
  if (!lesson || lesson.lastPage <= lesson.firstPage) return lessons;
  const middle = lesson.firstPage + Math.ceil((lesson.lastPage - lesson.firstPage + 1) / 2);
  const next = [...lessons];
  next.splice(index + 1, 0, {
    title: `${lesson.title} (suite)`.slice(0, 200),
    firstPage: middle,
    selected: lesson.selected,
  });
  return next;
}

/** Réunit une leçon et la suivante ; le titre de la première reste. */
export function mergeWithNext(lessons: LessonDraft[], index: number): LessonDraft[] {
  if (index < 0 || index >= lessons.length - 1) return lessons;
  const next = [...lessons];
  const [removed] = next.splice(index + 1, 1);
  const kept = next[index];
  if (kept && removed) next[index] = { ...kept, selected: kept.selected || removed.selected };
  return next;
}
