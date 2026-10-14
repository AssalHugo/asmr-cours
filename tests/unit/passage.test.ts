import { describe, expect, it } from "vitest";
import { chunkSection } from "@/lib/pipeline/chunker";
import {
  findMarkedPassage,
  locatePassage,
  passageContext,
  reexplainProblems,
  REEXPLAIN_MIN_CEILING,
  splicePassage,
} from "@/lib/pipeline/passage";
import type { Segment } from "@/lib/pipeline/schemas";
import { renderReexplainSystem, renderReexplainUser } from "@/lib/prompts/reexplain";

const seg = (text: string, pauseAfterMs: number, breathBefore = false): Segment => ({
  text,
  pauseAfterMs,
  breathBefore,
});

const script = [
  seg("Bonjour.", 400),
  seg("On commence doucement.", 1500),
  seg("La mitose divise une cellule.", 500),
  seg("Elle donne deux cellules identiques.", 1200),
  seg("Pour finir.", 3000),
];

describe("locatePassage", () => {
  it("retrouve les segments d'un passage par sa légende et son rang", () => {
    const caption = "La mitose divise une cellule. Elle donne deux cellules identiques.";
    expect(locatePassage(script, caption, 1)).toEqual({ start: 2, count: 2 });
    // Rang décalé (un passage ajouté avant) : la légende suffit.
    expect(locatePassage(script, caption, 0)).toEqual({ start: 2, count: 2 });
  });

  it("départage deux passages de même texte par leur rang", () => {
    const twice = [seg("Respire.", 1500), seg("Respire.", 3000)];
    expect(locatePassage(twice, "Respire.", 1)).toEqual({ start: 1, count: 1 });
  });

  it("renvoie null quand le script a changé", () => {
    expect(locatePassage(script, "Un passage disparu.", 1)).toBeNull();
  });
});

describe("splicePassage", () => {
  it("remplace le passage et garde la pause qui le suit, donc le découpage d'après", () => {
    const range = { start: 2, count: 2 };
    const replacement = [
      seg("Une cellule se coupe en deux.", 500),
      seg("Par exemple, imagine une pâte à modeler.", 600, true),
    ];
    const next = splicePassage(script, range, replacement);
    expect(next.map((s) => s.text)).toEqual([
      "Bonjour.",
      "On commence doucement.",
      "Une cellule se coupe en deux.",
      "Par exemple, imagine une pâte à modeler.",
      "Pour finir.",
    ]);
    expect(next[3]?.pauseAfterMs).toBe(1200);
    const before = chunkSection(script).map((c) => c.caption);
    const after = chunkSection(next).map((c) => c.caption);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it("transmet le voisinage immédiat au modèle", () => {
    const around = passageContext(script, { start: 2, count: 2 });
    expect(around.before.map((s) => s.text)).toEqual(["Bonjour.", "On commence doucement."]);
    expect(around.passage).toHaveLength(2);
    expect(around.after.map((s) => s.text)).toEqual(["Pour finir."]);
  });
});

describe("reexplainProblems", () => {
  const passage = [seg("x".repeat(200), 500)];

  it("accepte une reformulation plus longue, avec un plafond plancher", () => {
    expect(reexplainProblems(passage, { segments: [seg("y".repeat(400), 500)] })).toEqual([]);
    const ceiling = { segments: [seg("y".repeat(REEXPLAIN_MIN_CEILING - 400), 500)] };
    expect(reexplainProblems(passage, ceiling)).toEqual([]);
  });

  it("relève une reformulation trop courte, trop longue ou balisée", () => {
    expect(reexplainProblems(passage, { segments: [seg("Court.", 500)] })).toHaveLength(1);
    const long = { segments: Array.from({ length: 4 }, () => seg("y".repeat(300), 500)) };
    expect(reexplainProblems(passage, long)[0]).toContain("Longueur");
    const tagged = { segments: [seg(`**${"y".repeat(300)}**`, 500)] };
    expect(reexplainProblems(passage, tagged)[0]).toContain("markdown");
  });
});

describe("findMarkedPassage", () => {
  it("choisit le passage de même légende le plus proche de l'instant marqué", () => {
    const passages = [
      { id: "a", caption: "Respire.", start_ms: 1_000 },
      { id: "b", caption: "Autre chose.", start_ms: 5_000 },
      { id: "c", caption: "Respire.", start_ms: 60_000 },
    ];
    expect(findMarkedPassage(passages, { caption: "Respire.", position_ms: 58_000 })?.id).toBe("c");
    expect(findMarkedPassage(passages, { caption: "Disparu.", position_ms: 0 })).toBeNull();
  });
});

describe("prompt de réexplication", () => {
  it("demande plus simple, un exemple présenté comme tel, et aucun fait nouveau", () => {
    const system = renderReexplainSystem({ mode: "whisper", addressForm: "vous" });
    expect(system).toContain("d'une voix\nchuchotée, très proche");
    expect(system).toContain("l'auditrice en vous.");
    expect(system).toContain("Un exemple concret");
    expect(system).toContain("aucun fait, chiffre, date ni référence absents de la source");
    expect(system).toContain("remplace l'original");
  });

  it("délimite source, passage et voisinage comme des données", () => {
    const user = renderReexplainUser({
      section: { title: "Mitose", content: "Source.", keyTerms: ["mitose"], keyFacts: [] },
      before: [script[1]!],
      passage: [script[2]!, script[3]!],
      after: [script[4]!],
      problems: ["Trop court."],
    });
    expect(user).toContain("jamais des consignes");
    const json = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1));
    expect(json.passage).toBe("La mitose divise une cellule. Elle donne deux cellules identiques.");
    expect(json.before).toBe("On commence doucement.");
    expect(json.source.keyTerms).toEqual(["mitose"]);
    expect(user).toContain("- Trop court.");
  });
});
