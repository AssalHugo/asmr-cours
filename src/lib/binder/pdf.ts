import "server-only";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { APPROX_CHARS_PER_SCANNED_PAGE, SCAN_THRESHOLD_CHARS_PER_PAGE } from "@/lib/pdf";
import type { OutlineEntry } from "./detect";

export type PdfAnalysis = {
  pages: number;
  pageTexts: string[];
  /** Caractères par page ; estimés pour un scan, dont le texte n'est lisible qu'après analyse. */
  pageChars: number[];
  scanned: boolean;
  outline: OutlineEntry[];
};

/** Texte de chaque page et signets d'un PDF, sans IA : 315 pages se lisent en 2 s. */
export async function analyzePdf(data: Buffer): Promise<PdfAnalysis> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const measured = text.map((t) => t.replace(/\s+/g, " ").trim().length);
  const total = measured.reduce((a, b) => a + b, 0);
  const scanned = total < totalPages * SCAN_THRESHOLD_CHARS_PER_PAGE;

  const outline: OutlineEntry[] = [];
  for (const item of (await pdf.getOutline().catch(() => null)) ?? []) {
    let page: number | null = null;
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      const ref: unknown = dest?.[0];
      if (ref && typeof ref === "object") {
        page = (await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0])) + 1;
      } else if (typeof ref === "number") {
        page = ref + 1;
      }
    } catch {
      page = null;
    }
    outline.push({ title: item.title, page });
  }

  return {
    pages: totalPages,
    pageTexts: text,
    pageChars: scanned ? measured.map(() => APPROX_CHARS_PER_SCANNED_PAGE) : measured,
    scanned,
    outline,
  };
}

/** Un PDF par plage de pages (numérotées à partir de 1), le document n'étant lu qu'une fois. */
export async function extractPages(
  data: Buffer,
  ranges: { firstPage: number; lastPage: number }[],
): Promise<Buffer[]> {
  const source = await PDFDocument.load(data, { ignoreEncryption: true });
  const parts: Buffer[] = [];
  for (const range of ranges) {
    const out = await PDFDocument.create();
    const indices = Array.from(
      { length: range.lastPage - range.firstPage + 1 },
      (_, i) => range.firstPage - 1 + i,
    );
    for (const page of await out.copyPages(source, indices)) out.addPage(page);
    parts.push(Buffer.from(await out.save()));
  }
  return parts;
}
