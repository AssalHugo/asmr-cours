/**
 * Découpage d'un classeur en leçons, sans IA : sommaire en tête du document, signets du PDF,
 * ou à défaut tranches régulières. Fonctions pures, testées sur le texte des pages.
 */

export type DetectionMethod = "toc" | "outline" | "pages";

/** Leçon proposée : elle court de `firstPage` jusqu'à la veille de la leçon suivante. */
export type LessonDraft = { title: string; firstPage: number; selected: boolean };

export type OutlineEntry = { title: string; page: number | null };

export type Detection = { method: DetectionMethod; lessons: LessonDraft[] };

export type LessonLimits = { maxPages: number; maxChars: number };

/** Pages lues pour trouver le sommaire. */
const TOC_SCAN_PAGES = 20;
/** Renvois de page à partir desquels une page est un sommaire. */
const TOC_MIN_REFS = 3;
/** Taille des tranches quand rien ne structure le document. */
const FALLBACK_PAGES = 20;
const MAX_OFFSET = 12;
export const PREFACE_TITLE = "Début du document";

type PageRef = { page: number; start: number; end: number };

/**
 * Renvois de page en fin de ligne : « p39 », « P. 39 », « page 39 », ou points de conduite
 * « Titre ........ 39 ». En fin de ligne seulement : « le gène p53 » n'en est pas un.
 */
const REF_PATTERNS = [
  /(?:^|[\s(])(?:p\.?|pages?)\s?(\d{1,4})[ \t]*(?=\n|$)/gim,
  /[._…·]{3,}[ \t]*(\d{1,4})[ \t]*(?=\n|$)/gm,
];

export function findPageRefs(text: string): PageRef[] {
  const refs: PageRef[] = [];
  for (const pattern of REF_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const page = Number(match[1]);
      // Le blanc ou la parenthèse qui précède appartient encore au titre.
      const lead = /^[\s(]/.test(match[0]) ? 1 : 0;
      refs.push({ page, start: match.index + lead, end: match.index + match[0].length });
    }
  }
  return refs.sort((a, b) => a.start - b.start);
}

const HEADINGS = /\b(table des mati[eè]res|sommaire|plan du cours|contents)\b/gi;

/** Titre lu avant un renvoi : sans numéros d'ordre, intitulés de sommaire ni noms isolés. */
export function cleanTitle(raw: string): string {
  const lines = raw
    .replace(HEADINGS, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    // Numéro d'ordre (« 01 », « 03 P39 ») ou renvoi resté seul sur sa ligne.
    .filter(
      (l) => l.length > 0 && !/^(?:\d{1,3}|[pP]\.?\s?\d{1,4})(?:\s+[pP]\.?\s?\d{1,4})?$/.test(l),
    );
  // Un mot seul sur sa ligne est presque toujours un nom d'enseignant ou un intitulé de partie.
  const kept = lines.filter((l) => !/^[\p{L}'’-]+$/u.test(l));
  const parts = kept.length > 0 ? kept : lines;
  let title = "";
  for (const part of parts) {
    if (title.endsWith("-")) title += part;
    else title += (title ? " " : "") + part;
  }
  return title
    .replace(/[\s._…·:–-]+$/, "")
    .replace(/^[\s.:–-]+/, "")
    .slice(0, 200)
    .trim();
}

/**
 * Entrées du sommaire en tête du document : les pages consécutives qui portent chacune au
 * moins trois renvois. Le sommaire propre à une leçon, plus loin, n'est pas lu.
 */
export function parseToc(pageTexts: string[]): { title: string; page: number }[] {
  const scan = pageTexts.slice(0, TOC_SCAN_PAGES);
  const first = scan.findIndex((t) => findPageRefs(t).length >= TOC_MIN_REFS);
  if (first < 0) return [];
  const entries: { title: string; page: number }[] = [];
  for (let index = first; index < scan.length; index++) {
    const text = scan[index] ?? "";
    const refs = findPageRefs(text);
    if (index > first && refs.length < 2) break;
    let cursor = 0;
    for (const ref of refs) {
      entries.push({ title: cleanTitle(text.slice(cursor, ref.start)), page: ref.page });
      cursor = ref.end;
    }
  }
  // Les colonnes d'un sommaire ne sont pas lues dans l'ordre : on trie, et deux renvois vers la
  // même page (« 03 P39 » puis « p39 ») n'en font qu'un, avec le premier titre non vide.
  const byPage = new Map<number, string>();
  for (const entry of entries.sort((a, b) => a.page - b.page)) {
    if (!byPage.get(entry.page)) byPage.set(entry.page, entry.title);
  }
  return [...byPage].map(([page, title]) => ({ page, title }));
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Racines des mots significatifs d'un titre, pour le retrouver en tête de sa page. */
const stems = (text: string) =>
  normalize(text)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 6));

/**
 * Décalage entre les numéros du sommaire et les pages du PDF (couverture non numérotée…) :
 * celui qui retrouve le plus de titres sur leur première page. À égalité, aucun décalage.
 */
export function alignOffset(entries: { title: string; page: number }[], pageTexts: string[]) {
  let best = { offset: 0, score: -1 };
  for (const offset of [
    0,
    ...Array.from({ length: MAX_OFFSET * 2 }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1)),
  ]) {
    let score = 0;
    for (const entry of entries) {
      const words = stems(entry.title);
      const head = normalize((pageTexts[entry.page + offset - 1] ?? "").slice(0, 1500));
      if (words.length === 0 || head.length === 0) continue;
      const found = words.filter((w) => head.includes(w)).length;
      if (found / words.length >= 0.5) score++;
    }
    if (score > best.score) best = { offset, score };
  }
  return best.offset;
}

/** Leçons à partir de leurs premières pages ; ce qui précède la première devient une préface. */
export function lessonsFromStarts(
  starts: { title: string; page: number }[],
  totalPages: number,
): LessonDraft[] {
  const sorted = starts
    .filter((s) => s.page >= 1 && s.page <= totalPages)
    .sort((a, b) => a.page - b.page)
    .filter((s, i, all) => i === 0 || s.page !== all[i - 1]?.page);
  const lessons: LessonDraft[] = sorted.map((s, index) => ({
    title: s.title || `Leçon ${index + 1}`,
    firstPage: s.page,
    selected: true,
  }));
  const firstStart = lessons[0]?.firstPage ?? 1;
  if (firstStart > 1) {
    // Couverture et sommaire : gardés pour que les leçons couvrent tout, mais pas cochés.
    lessons.unshift({ title: PREFACE_TITLE, firstPage: 1, selected: false });
  }
  return lessons.length > 0 ? lessons : [{ title: "Leçon 1", firstPage: 1, selected: true }];
}

/** Dernière page de chaque leçon : la veille de la suivante. */
export function withLastPages<T extends { firstPage: number }>(
  lessons: T[],
  totalPages: number,
): (T & { lastPage: number })[] {
  return lessons.map((lesson, index) => ({
    ...lesson,
    lastPage: (lessons[index + 1]?.firstPage ?? totalPages + 1) - 1,
  }));
}

/**
 * Pages réellement envoyées : sans les pages vides en bordure (pages de garde). Un scan n'a
 * pas de texte lisible : rien n'est retiré.
 */
export function effectiveRange(
  firstPage: number,
  lastPage: number,
  pageChars: number[],
  scanned: boolean,
): { firstPage: number; lastPage: number } | null {
  if (scanned) return { firstPage, lastPage };
  let first = firstPage;
  let last = lastPage;
  while (first <= last && (pageChars[first - 1] ?? 0) === 0) first++;
  while (last >= first && (pageChars[last - 1] ?? 0) === 0) last--;
  return first <= last ? { firstPage: first, lastPage: last } : null;
}

export function rangeChars(firstPage: number, lastPage: number, pageChars: number[]): number {
  let sum = 0;
  for (let page = firstPage; page <= lastPage; page++) sum += pageChars[page - 1] ?? 0;
  return sum;
}

/** Coupe en parts égales les leçons trop longues pour un seul cours. */
export function splitOversized(
  lessons: LessonDraft[],
  totalPages: number,
  pageChars: number[],
  limits: LessonLimits,
): LessonDraft[] {
  return withLastPages(lessons, totalPages).flatMap((lesson) => {
    const pages = lesson.lastPage - lesson.firstPage + 1;
    const chars = rangeChars(lesson.firstPage, lesson.lastPage, pageChars);
    const parts = Math.max(
      1,
      Math.ceil(pages / limits.maxPages),
      Math.ceil(chars / limits.maxChars),
    );
    if (parts === 1 || pages < 2) return [toDraft(lesson)];
    const size = Math.ceil(pages / Math.min(parts, pages));
    const count = Math.ceil(pages / size);
    return Array.from({ length: count }, (_, i) => ({
      title: `${lesson.title} (partie ${i + 1})`.slice(0, 200),
      firstPage: lesson.firstPage + i * size,
      selected: lesson.selected,
    }));
  });
}

const toDraft = ({ title, firstPage, selected }: LessonDraft): LessonDraft => ({
  title,
  firstPage,
  selected,
});

/** Signets exploitables : au moins deux, avec leur page, et des titres qui diffèrent. */
function fromOutline(outline: OutlineEntry[]): { title: string; page: number }[] {
  const usable = outline.flatMap((o) =>
    o.page !== null && o.title.trim() ? [{ title: o.title.trim(), page: o.page }] : [],
  );
  const titles = new Set(usable.map((o) => normalize(o.title)));
  // « Page vierge » répété sur chaque page de garde ne structure rien.
  return usable.length >= 2 && titles.size >= usable.length * 0.8 ? usable : [];
}

/** Découpe un classeur : sommaire, puis signets, puis tranches régulières. */
export function detectLessons(input: {
  pageTexts: string[];
  pageChars: number[];
  outline: OutlineEntry[];
  limits: LessonLimits;
}): Detection {
  const { pageTexts, pageChars, outline, limits } = input;
  const total = pageTexts.length;
  const finish = (method: DetectionMethod, starts: { title: string; page: number }[]) => ({
    method,
    lessons: splitOversized(lessonsFromStarts(starts, total), total, pageChars, limits),
  });

  const toc = parseToc(pageTexts);
  if (toc.length >= 2) {
    const offset = alignOffset(toc, pageTexts);
    const starts = toc
      .map((e) => ({ title: e.title, page: e.page + offset }))
      .filter((e) => e.page >= 1 && e.page <= total);
    if (starts.length >= 2) return finish("toc", starts);
  }

  const marks = fromOutline(outline);
  if (marks.length >= 2) return finish("outline", marks);

  const size = Math.min(FALLBACK_PAGES, limits.maxPages);
  const slices = Array.from({ length: Math.ceil(total / size) }, (_, i) => {
    const first = i * size + 1;
    const last = Math.min(total, first + size - 1);
    return { title: `Pages ${first} à ${last}`, page: first };
  });
  return finish("pages", slices);
}

/** Pages de l'échantillon : le début de la leçon, sans sa page de titre quand elle est longue. */
export function samplePages(
  range: { firstPage: number; lastPage: number },
  pageChars: number[],
  scanned: boolean,
  opts: { targetChars: number; maxPages: number },
): { firstPage: number; lastPage: number } {
  const pages = range.lastPage - range.firstPage + 1;
  const first = pages >= 4 ? range.firstPage + 1 : range.firstPage;
  let last = first;
  let chars = scanned ? 0 : (pageChars[first - 1] ?? 0);
  while (
    last < range.lastPage &&
    last - first + 1 < opts.maxPages &&
    (scanned || chars < opts.targetChars)
  ) {
    last++;
    chars += pageChars[last - 1] ?? 0;
  }
  return { firstPage: first, lastPage: last };
}
