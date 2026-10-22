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

export type OutlineNode = {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
};

/**
 * Signets d'un PDF : si l'arbre ne compte qu'un seul parent (ex. le titre du polycopié),
 * on descend dans ses enfants pour retrouver les leçons.
 */
export function flattenOutlineNodes(nodes: OutlineNode[]): OutlineNode[] {
  if (nodes.length === 1 && nodes[0]?.items && nodes[0].items.length >= 2) {
    return flattenOutlineNodes(nodes[0].items);
  }
  return nodes;
}

/** Texte de chaque page et signets d'un PDF, sans IA : 315 pages se lisent en 2 s. */
export async function analyzePdf(data: Buffer): Promise<PdfAnalysis> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const measured = text.map((t) => t.replace(/\s+/g, " ").trim().length);
  const total = measured.reduce((a, b) => a + b, 0);
  const scanned = total < totalPages * SCAN_THRESHOLD_CHARS_PER_PAGE;

  const rawOutline = (await pdf.getOutline().catch(() => null)) as OutlineNode[] | null;
  const nodes = flattenOutlineNodes(rawOutline ?? []);
  const outline: OutlineEntry[] = [];
  for (const item of nodes) {
    let page: number | null = null;
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      const ref: unknown = (dest as unknown[])?.[0];
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

/**
 * Un PDF par plage de pages (numérotées à partir de 1), le document n'étant lu qu'une fois.
 * Si `onPart` est fourni, chaque extrait lui est transmis au fil de l'eau, ce qui évite
 * d'accumuler tous les Buffers en mémoire.
 */
export async function extractPages(
  data: Buffer,
  ranges: { firstPage: number; lastPage: number }[],
  onPart?: (part: Buffer, index: number) => Promise<void>,
): Promise<Buffer[]> {
  const source = await PDFDocument.load(data, { ignoreEncryption: true });
  const parts: Buffer[] = [];
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]!;
    const out = await PDFDocument.create();
    const indices = Array.from(
      { length: range.lastPage - range.firstPage + 1 },
      (_, i) => range.firstPage - 1 + i,
    );
    for (const page of await out.copyPages(source, indices)) out.addPage(page);
    const buf = Buffer.from(await out.save());
    if (onPart) {
      await onPart(buf, index);
    } else {
      parts.push(buf);
    }
  }
  return parts;
}
