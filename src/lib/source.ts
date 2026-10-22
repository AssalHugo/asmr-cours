import "server-only";
import { env } from "@/lib/env";
import { APPROX_CHARS_PER_PHOTO, inspectPdf } from "@/lib/pdf";
import { keys, storage } from "@/lib/storage";
import { MAX_IMAGES } from "@/lib/uploads";

export type SourceInfo = {
  kind: "pdf" | "images" | "text";
  keys: string[];
  sourceChars: number;
  pages: number;
  /** Vrai quand la taille est estimée (scan, photos) : l'extraction donnera le chiffre exact. */
  approximate: boolean;
};

export type SourceCheck =
  | { ok: true; info: SourceInfo }
  /** `too_long` : le PDF pourrait devenir un classeur, découpé en leçons. */
  | { ok: false; message: string; reason?: "too_long" };

const refuse = (message: string, reason?: "too_long"): SourceCheck => ({
  ok: false,
  message,
  reason,
});

/**
 * Contrôle serveur des sources d'un cours : appartenance des clés, présence, taille,
 * nombre de pages. Refait au lancement, sans rien croire de ce qu'envoie le navigateur.
 */
export async function inspectSource(
  userId: string,
  courseId: string,
  kind: SourceInfo["kind"],
  sourceKeys: string[],
): Promise<SourceCheck> {
  const e = env();
  const prefix = keys.uploadPrefix(userId, courseId);
  if (sourceKeys.some((k) => !k.startsWith(prefix) || k.includes(".."))) {
    return refuse("Ces fichiers n'appartiennent pas à ce cours.");
  }
  const store = storage();
  const heads = await Promise.all(sourceKeys.map((k) => store.head(k)));
  if (heads.some((h) => h === null))
    return refuse("Un fichier n'est pas arrivé. Dépose-le de nouveau.");
  const maxBytes = e.MAX_UPLOAD_MB * 1024 * 1024;
  if (heads.some((h) => (h?.bytes ?? 0) > maxBytes)) {
    return refuse(`Fichier trop lourd : ${e.MAX_UPLOAD_MB} Mo maximum.`);
  }
  const [firstKey] = sourceKeys;
  if (!firstKey) return refuse("Aucune source.");

  if (kind === "text") {
    if (sourceKeys.length !== 1) return refuse("Source invalide.");
    const chars = (await store.get(firstKey)).toString("utf8").length;
    if (chars > e.MAX_SOURCE_CHARS) return refuse(tooLong(chars, e.MAX_SOURCE_CHARS));
    return {
      ok: true,
      info: { kind, keys: sourceKeys, sourceChars: chars, pages: 0, approximate: false },
    };
  }

  if (kind === "pdf") {
    if (sourceKeys.length !== 1 || !firstKey.endsWith(".pdf"))
      return refuse("Un seul PDF par cours.");
    let pdf;
    try {
      pdf = await inspectPdf(await store.get(firstKey));
    } catch {
      return refuse("Ce PDF est illisible ou protégé. Essaie de l'exporter de nouveau.");
    }
    if (pdf.pages > e.MAX_PDF_PAGES) {
      return refuse(
        `Ce PDF fait ${pdf.pages} pages : un cours en compte ${e.MAX_PDF_PAGES} au plus.`,
        "too_long",
      );
    }
    if (pdf.chars > e.MAX_SOURCE_CHARS) {
      return refuse(tooLong(pdf.chars, e.MAX_SOURCE_CHARS), "too_long");
    }
    return {
      ok: true,
      info: {
        kind,
        keys: sourceKeys,
        sourceChars: pdf.chars,
        pages: pdf.pages,
        approximate: pdf.approximate,
      },
    };
  }

  if (sourceKeys.length > MAX_IMAGES) return refuse(`${MAX_IMAGES} photos maximum par cours.`);
  return {
    ok: true,
    info: {
      kind,
      keys: sourceKeys,
      sourceChars: sourceKeys.length * APPROX_CHARS_PER_PHOTO,
      pages: sourceKeys.length,
      approximate: true,
    },
  };
}

function tooLong(chars: number, max: number): string {
  return `Ce cours fait environ ${chars.toLocaleString("fr-FR")} caractères : la limite est de ${max.toLocaleString("fr-FR")}. Découpe-le en plusieurs cours.`;
}
