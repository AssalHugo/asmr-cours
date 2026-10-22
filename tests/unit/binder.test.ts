import { describe, expect, it } from "vitest";
import {
  alignOffset,
  cleanTitle,
  detectLessons,
  effectiveRange,
  findPageRefs,
  parseToc,
  PREFACE_TITLE,
  samplePages,
  splitOversized,
  withLastPages,
} from "@/lib/binder/detect";
import { mergeWithNext, partitionError, planLessons, splitLesson } from "@/lib/binder/lessons";
import { sampleSection } from "@/lib/pipeline/sections";

// Sommaire tel que pdf.js lit celui d'un polycopié du tutorat : deux colonnes mêlées, numéros
// d'ordre, noms d'enseignants, renvois doublés (« 03 P39 » puis « p39 »).
const TOC_1 = `TABLE DES MATIÈRES Cottrel
Parasitologie et Mycologie
Médicale (C3-L1)
01 P7
p7
Sartelet
ACP1 - Le diagnostic en anatomie et
cytologie pathologiques : indications et
principes techniques (C9-L1)
03 P12
p12
ACP3 - L'inflammation : aspects anatomo-
pathologiques (C9-L3) p20`;
const TOC_2 = `TABLE DES MATIÈRES Lozniewski
Antibiotiques et bactéries
(C18-L2) p28
Place de la microbiologie en
médecine (C15-L2) p16`;

/** Document factice : couverture, sommaire, page vide, puis une page de texte par page. */
function documentPages(total: number, headings: Record<number, string>): string[] {
  return Array.from({ length: total }, (_, i) => {
    const page = i + 1;
    if (page === 1) return "UE 6 Anatomopathologie";
    if (page === 2) return TOC_1;
    if (page === 3) return TOC_2;
    if (page === 4) return "";
    const heading = headings[page];
    return `${heading ? `${heading}\nSOMMAIRE :\nI. GÉNÉRALITÉS ______ ${page + 1}\n` : ""}${"Texte du cours. ".repeat(40)}`;
  });
}
const HEADINGS = {
  7: "PARASITOLOGIE ET MYCOLOGIE MEDICALE",
  12: "ACP1 : LE DIAGNOSTIC EN ANATOMIE ET CYTOLOGIE PATHOLOGIQUE",
  16: "PLACE DE LA MICROBIOLOGIE EN MEDECINE",
  20: "L’INFLAMMATION : ASPECTS ANATOMO-PATHOLOGIQUE",
  28: "ANTIBIOTIQUES ET BACTERIES",
};
const LIMITS = { maxPages: 80, maxChars: 150_000 };
const chars = (pages: string[]) => pages.map((t) => t.replace(/\s+/g, " ").trim().length);

describe("renvois de page", () => {
  it("reconnaît « p39 », « P. 39 », « page 39 » et les points de conduite, en fin de ligne", () => {
    const refs = findPageRefs("Intro p7\nSuite P. 12\nAnnexe page 30\nBilan ........ 41\n");
    expect(refs.map((r) => r.page)).toEqual([7, 12, 30, 41]);
  });
  it("ignore un nom comme « p53 » au milieu d'une ligne", () => {
    expect(findPageRefs("Le gène p53 et le cancer (C9-L4) p91").map((r) => r.page)).toEqual([91]);
  });
});

describe("titres du sommaire", () => {
  it("retire intitulé, numéros d'ordre et noms isolés, et recolle les coupures", () => {
    expect(
      cleanTitle("TABLE DES MATIÈRES Cottrel\nParasitologie et Mycologie\nMédicale (C3-L1)\n01 "),
    ).toBe("Parasitologie et Mycologie Médicale (C3-L1)");
    expect(cleanTitle("\nACP3 - L'inflammation : aspects anatomo-\npathologiques (C9-L3)")).toBe(
      "ACP3 - L'inflammation : aspects anatomo-pathologiques (C9-L3)",
    );
  });
  it("garde le code du cours seul sur sa ligne", () => {
    expect(cleanTitle("\nAntibiotiques et bactéries\n(C18-L2)")).toBe(
      "Antibiotiques et bactéries (C18-L2)",
    );
  });
});

describe("lecture du sommaire", () => {
  it("trie les entrées des deux colonnes et fusionne les renvois doublés", () => {
    const pages = documentPages(30, HEADINGS);
    expect(parseToc(pages)).toEqual([
      { page: 7, title: "Parasitologie et Mycologie Médicale (C3-L1)" },
      {
        page: 12,
        title:
          "ACP1 - Le diagnostic en anatomie et cytologie pathologiques : indications et principes techniques (C9-L1)",
      },
      { page: 16, title: "Place de la microbiologie en médecine (C15-L2)" },
      { page: 20, title: "ACP3 - L'inflammation : aspects anatomo-pathologiques (C9-L3)" },
      { page: 28, title: "Antibiotiques et bactéries (C18-L2)" },
    ]);
  });
  it("ne lit pas le sommaire propre à une leçon, plus loin dans le document", () => {
    const pages = documentPages(30, HEADINGS);
    expect(parseToc(pages).every((e) => e.page !== 8)).toBe(true);
  });
  it("retrouve le décalage quand la couverture n'est pas numérotée", () => {
    const pages = ["Couverture", ...documentPages(30, HEADINGS)];
    expect(alignOffset(parseToc(pages), pages)).toBe(1);
    expect(alignOffset(parseToc(documentPages(30, HEADINGS)), documentPages(30, HEADINGS))).toBe(0);
  });
});

describe("découpage d'un classeur", () => {
  it("propose une leçon par entrée du sommaire, après une préface non cochée", () => {
    const pages = documentPages(30, HEADINGS);
    const { method, lessons } = detectLessons({
      pageTexts: pages,
      pageChars: chars(pages),
      outline: [],
      limits: LIMITS,
    });
    expect(method).toBe("toc");
    expect(lessons.map((l) => [l.firstPage, l.selected])).toEqual([
      [1, false],
      [7, true],
      [12, true],
      [16, true],
      [20, true],
      [28, true],
    ]);
    expect(lessons[0]?.title).toBe(PREFACE_TITLE);
    expect(withLastPages(lessons, 30).at(-1)?.lastPage).toBe(30);
  });
  it("prend les signets quand il n'y a pas de sommaire, mais pas des « Page vierge » répétés", () => {
    const pages = Array.from({ length: 40 }, () => "Texte. ".repeat(50));
    const pageChars = chars(pages);
    const blank = Array.from({ length: 5 }, (_, i) => ({ title: "Page vierge", page: i * 8 + 1 }));
    expect(
      detectLessons({ pageTexts: pages, pageChars, outline: blank, limits: LIMITS }).method,
    ).toBe("pages");
    const outline = [
      { title: "Chapitre 1", page: 1 },
      { title: "Chapitre 2", page: 15 },
      { title: "Sans page", page: null },
    ];
    const detection = detectLessons({ pageTexts: pages, pageChars, outline, limits: LIMITS });
    expect(detection.method).toBe("outline");
    expect(detection.lessons.map((l) => l.firstPage)).toEqual([1, 15]);
  });
  it("découpe par tranches régulières en dernier recours", () => {
    const pages = Array.from({ length: 45 }, () => "Texte. ".repeat(50));
    const detection = detectLessons({
      pageTexts: pages,
      pageChars: chars(pages),
      outline: [],
      limits: LIMITS,
    });
    expect(detection.lessons.map((l) => [l.firstPage, l.title])).toEqual([
      [1, "Pages 1 à 20"],
      [21, "Pages 21 à 40"],
      [41, "Pages 41 à 45"],
    ]);
  });
  it("coupe en parts égales une leçon trop longue pour un cours", () => {
    const pageChars = Array.from({ length: 100 }, () => 2000);
    const lessons = splitOversized(
      [{ title: "Gros cours", firstPage: 1, selected: true }],
      100,
      pageChars,
      { maxPages: 80, maxChars: 150_000 },
    );
    expect(lessons.map((l) => [l.firstPage, l.title])).toEqual([
      [1, "Gros cours (partie 1)"],
      [51, "Gros cours (partie 2)"],
    ]);
  });
});

describe("leçons modifiées à l'écran", () => {
  const shape = {
    pages: 20,
    pageChars: [0, ...Array.from({ length: 18 }, () => 1000), 0],
    scanned: false,
  };

  it("retire les pages vides en bordure, sauf pour un scan", () => {
    expect(effectiveRange(1, 20, shape.pageChars, false)).toEqual({ firstPage: 2, lastPage: 19 });
    expect(effectiveRange(1, 1, shape.pageChars, false)).toBeNull();
    expect(effectiveRange(1, 20, shape.pageChars, true)).toEqual({ firstPage: 1, lastPage: 20 });
  });
  it("signale une leçon vide, trop longue ou trop fournie", () => {
    const planned = planLessons(
      [
        { title: "Garde", firstPage: 1, selected: true },
        { title: "Cours", firstPage: 2, selected: true },
      ],
      shape,
      { maxPages: 10, maxChars: 150_000 },
    );
    expect(planned[0]?.problem).toBe("Ces pages sont vides.");
    expect(planned[1]).toMatchObject({ lastPage: 20, pages: 18, chars: 18_000 });
    expect(planned[1]?.problem).toMatch(/10 au plus/);
  });
  it("exige des leçons qui se suivent depuis la page 1", () => {
    expect(partitionError([{ firstPage: 1 }, { firstPage: 5 }], 20)).toBeNull();
    expect(partitionError([{ firstPage: 2 }], 20)).toMatch(/page 1/);
    expect(partitionError([{ firstPage: 1 }, { firstPage: 1 }], 20)).toMatch(/leçon 2/);
    expect(partitionError([{ firstPage: 1 }, { firstPage: 21 }], 20)).toMatch(/leçon 2/);
  });
  it("coupe une leçon en deux et réunit deux leçons", () => {
    const lessons = [
      { title: "A", firstPage: 1, selected: true },
      { title: "B", firstPage: 11, selected: false },
    ];
    const split = splitLesson(lessons, 0, 20);
    expect(split.map((l) => [l.title, l.firstPage])).toEqual([
      ["A", 1],
      ["A (suite)", 6],
      ["B", 11],
    ]);
    expect(mergeWithNext(split, 0).map((l) => [l.title, l.selected])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(mergeWithNext(lessons, 0)).toEqual([{ title: "A", firstPage: 1, selected: true }]);
  });
});

describe("échantillon", () => {
  it("lit le début d'une leçon, sans sa page de titre quand elle est longue", () => {
    const pageChars = Array.from({ length: 30 }, () => 2500);
    expect(
      samplePages({ firstPage: 10, lastPage: 20 }, pageChars, false, {
        targetChars: 6000,
        maxPages: 4,
      }),
    ).toEqual({ firstPage: 11, lastPage: 13 });
    expect(
      samplePages({ firstPage: 10, lastPage: 11 }, pageChars, false, {
        targetChars: 6000,
        maxPages: 4,
      }),
    ).toEqual({ firstPage: 10, lastPage: 11 });
  });
  it("garde une seule section, coupée en fin de phrase, avec ses termes", () => {
    const sentence = "La nécrose est une mort cellulaire. ";
    const [section, ...rest] = sampleSection(
      [
        {
          title: "Lésions",
          content: sentence.repeat(60),
          keyTerms: ["nécrose", "apoptose"],
          keyFacts: ["La nécrose est une mort cellulaire."],
        },
        { title: "Suite", content: sentence.repeat(60), keyTerms: [], keyFacts: [] },
      ],
      500,
    );
    expect(rest).toEqual([]);
    expect(section?.content.length).toBeLessThanOrEqual(500);
    expect(section?.content.endsWith(".")).toBe(true);
    expect(section?.keyTerms).toEqual(["nécrose"]);
    expect(section?.keyFacts).toHaveLength(1);
  });
});
