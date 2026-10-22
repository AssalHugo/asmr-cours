import { SECTION_MAX_CHARS, SECTION_MIN_CHARS, type ExtractedSection } from "./schemas";

/**
 * Ramène les sections extraites entre 1 500 et 6 000 caractères (§8.1) :
 * les trop longues sont redécoupées en fin de phrase, les trop courtes fusionnées
 * avec leur voisine. Fonction pure.
 */
export function normalizeSections(sections: ExtractedSection[]): ExtractedSection[] {
  const split = sections.flatMap(splitSection);
  const merged: ExtractedSection[] = [];
  for (const section of split) {
    const previous = merged.at(-1);
    if (previous && shouldMerge(previous, section))
      merged[merged.length - 1] = merge(previous, section);
    else merged.push(section);
  }
  // Une dernière section trop courte rejoint la précédente si le total reste dans les bornes.
  const last = merged.at(-1);
  const beforeLast = merged.at(-2);
  if (
    last &&
    beforeLast &&
    last.content.length < SECTION_MIN_CHARS &&
    beforeLast.content.length + last.content.length + 2 <= SECTION_MAX_CHARS
  ) {
    merged.splice(-2, 2, merge(beforeLast, last));
  }
  return merged;
}

function shouldMerge(previous: ExtractedSection, next: ExtractedSection): boolean {
  return (
    previous.content.length < SECTION_MIN_CHARS &&
    previous.content.length + next.content.length + 2 <= SECTION_MAX_CHARS
  );
}

function merge(a: ExtractedSection, b: ExtractedSection): ExtractedSection {
  return {
    title: a.content.length >= b.content.length ? a.title : b.title,
    content: `${a.content.trim()}\n\n${b.content.trim()}`,
    keyTerms: unique([...a.keyTerms, ...b.keyTerms]).slice(0, 12),
    keyFacts: unique([...a.keyFacts, ...b.keyFacts]).slice(0, 15),
  };
}

function splitSection(section: ExtractedSection): ExtractedSection[] {
  const content = section.content.trim();
  if (content.length <= SECTION_MAX_CHARS) return [{ ...section, content }];

  const parts = splitText(content, Math.ceil(content.length / SECTION_MAX_CHARS));
  const lowered = parts.map((p) => p.toLowerCase());
  const owner = (item: string) => {
    const exact = lowered.findIndex((p) => p.includes(item.toLowerCase()));
    if (exact >= 0) return exact;
    const words = item
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    let best = 0;
    let bestScore = -1;
    lowered.forEach((p, i) => {
      const score = words.filter((w) => p.includes(w)).length;
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    return best;
  };
  return parts.map((part, index) => ({
    title: index === 0 ? section.title : `${section.title} — partie ${index + 1}`,
    content: part,
    keyTerms: section.keyTerms.filter((t) => owner(t) === index),
    keyFacts: section.keyFacts.filter((f) => owner(f) === index),
  }));
}

/** Coupe un texte en `count` parts de taille voisine, toujours en fin de phrase. */
export function splitText(text: string, count: number): string[] {
  const sentences = text.match(/[^.!?…\n]+(?:[.!?…]+["»)]*|\n+|$)\s*/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  let remaining = text.length;
  for (const sentence of sentences) {
    const partsLeft = count - parts.length;
    const target = remaining / Math.max(1, partsLeft);
    if (
      current.length > 0 &&
      partsLeft > 1 &&
      (current.length + sentence.length > SECTION_MAX_CHARS ||
        current.length + sentence.length / 2 > target)
    ) {
      parts.push(current.trim());
      remaining -= current.length;
      current = "";
    }
    current += sentence;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Texte gardé pour l'échantillon d'un classeur : quelques minutes de voix. */
export const SAMPLE_MAX_CHARS = 4000;

/**
 * Échantillon : une seule section, le début du cours coupé en fin de phrase, avec les
 * termes et faits qu'il contient encore. Fonction pure.
 */
export function sampleSection(
  sections: ExtractedSection[],
  maxChars = SAMPLE_MAX_CHARS,
): ExtractedSection[] {
  const [first] = sections;
  if (!first) return sections;
  const joined = sections.map((s) => s.content.trim()).join("\n\n");
  const sentences = joined.match(/[^.!?…\n]+(?:[.!?…]+["»)]*|\n+|$)\s*/g) ?? [joined];
  let content = "";
  for (const sentence of sentences) {
    if (content.length > 0 && content.length + sentence.length > maxChars) break;
    content += sentence;
  }
  content = content.trim().slice(0, SECTION_MAX_CHARS);
  const lowered = content.toLowerCase();
  const inside = (item: string) => lowered.includes(item.toLowerCase());
  return [
    {
      title: first.title,
      content,
      keyTerms: unique(sections.flatMap((s) => s.keyTerms).filter(inside)).slice(0, 12),
      keyFacts: unique(sections.flatMap((s) => s.keyFacts).filter(inside)).slice(0, 15),
    },
  ];
}
