import {
  ExtractedCourse,
  Script,
  type ExtractedSection,
  type Segment,
} from "@/lib/pipeline/schemas";
import { MOCK_MODEL, NO_USAGE } from "@/lib/pricing";
import fixture from "./fixtures/course.json";
import type { LlmProvider } from "./provider";

const result = <T>(data: T) => ({ data, model: MOCK_MODEL, usage: NO_USAGE });

/**
 * LLM factice (`AI_MODE=mock`) : aucun appel réseau, coût nul, sorties déterministes.
 * Un PDF ou des photos renvoient le cours fixture ; un texte collé est découpé tel quel,
 * ce qui permet de tester de bout en bout avec son propre contenu.
 */
export function createMockLlm(): LlmProvider {
  return {
    id: "mock",

    async extract(input) {
      if (input.kind !== "text") return result(ExtractedCourse.parse(fixture));
      const paragraphs = input.text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const blocks = paragraphs.length > 0 ? paragraphs : [input.text.trim() || "Cours vide."];
      return result(
        ExtractedCourse.parse({
          title: firstWords(blocks[0] ?? "Cours", 8),
          language: "fr",
          sections: blocks.map((content, index) => ({
            title: `Partie ${index + 1}`,
            content,
            keyTerms: [],
            keyFacts: [],
          })),
        }),
      );
    },

    async rewrite({ section }) {
      return result(Script.parse({ segments: mockSegments(section) }));
    },

    async verify() {
      return result({ ok: true, missingFacts: [], alteredFacts: [], inventedClaims: [] });
    },
  };
}

function firstWords(text: string, count: number): string {
  return text.split(/\s+/).slice(0, count).join(" ").slice(0, 200);
}

/** Une phrase de la source = un segment, avec une grande pause toutes les trois phrases. */
export function mockSegments(section: ExtractedSection): Segment[] {
  const sentences = (section.content.match(/[^.!?…\n]+[.!?…]*/g) ?? [section.content])
    .map((s) =>
      s
        .replace(/[*_#`~|[\]<>{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s.length > 0)
    .flatMap((s) => (s.length <= 400 ? [s] : (s.match(/.{1,400}(?:\s|$)/g) ?? [s.slice(0, 400)])))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const kept = sentences.length > 0 ? sentences : ["Section vide."];
  return kept.map((text, index) => {
    const isLast = index === kept.length - 1;
    return {
      text,
      pauseAfterMs: isLast ? 3000 : index % 3 === 2 ? 1400 : index % 2 === 0 ? 450 : 650,
      breathBefore: index > 0 && index % 5 === 0,
    };
  });
}
