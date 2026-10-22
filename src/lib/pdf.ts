import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

/** En dessous de ce nombre de caractères par page, le PDF est traité comme un scan. */
export const SCAN_THRESHOLD_CHARS_PER_PAGE = 200;
/** Estimations quand le texte n'est pas lisible sans IA (scan, photo de notes). */
export const APPROX_CHARS_PER_SCANNED_PAGE = 1800;
export const APPROX_CHARS_PER_PHOTO = 1200;

export type PdfInfo = { pages: number; chars: number; approximate: boolean };

/** Compte les pages et le texte d'un PDF, sans IA, pour l'estimation avant lancement. */
export async function inspectPdf(data: Buffer): Promise<PdfInfo> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const chars = text.replace(/\s+/g, " ").trim().length;
  if (chars < totalPages * SCAN_THRESHOLD_CHARS_PER_PAGE) {
    return {
      pages: totalPages,
      chars: totalPages * APPROX_CHARS_PER_SCANNED_PAGE,
      approximate: true,
    };
  }
  return { pages: totalPages, chars, approximate: false };
}
