/** Régénère les fixtures binaires : pnpm exec tsx tests/fixtures/make-fixtures.ts */
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PAGES = [
  ["La memoire : encodage, stockage, recuperation", "Page 1 - Les trois etapes de la memoire."],
  ["La courbe de l'oubli", "Page 2 - Ebbinghaus, 1885. Repetition espacee et effet de test."],
  ["Sommeil et consolidation", "Page 3 - Hippocampe, sommeil lent profond, sommeil paradoxal."],
];

async function main() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle("Cours fixture - 3 pages");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  for (const [title, body] of PAGES) {
    const page = pdf.addPage([595, 842]);
    page.drawText(title ?? "", { x: 50, y: 780, size: 18, font });
    page.drawText(body ?? "", { x: 50, y: 740, size: 12, font });
  }
  await writeFile(new URL("./cours-3-pages.pdf", import.meta.url), await pdf.save());
  console.log("tests/fixtures/cours-3-pages.pdf écrit");
}

void main();
