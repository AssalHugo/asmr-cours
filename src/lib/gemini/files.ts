import "server-only";
import { readFile } from "node:fs/promises";
import { gemini, type MediaContent } from "./client";

export type SourceFile = { path: string; mimeType: string; bytes: number };

/** Au-delà, les fichiers passent par la Files API (une requête inline plafonne à 20 Mo). */
export const INLINE_LIMIT_BYTES = 12 * 1024 * 1024;

/** Prépare PDF ou images pour une interaction : inline si l'ensemble est petit, sinon Files API. */
export async function mediaContents(
  kind: "pdf" | "images",
  files: SourceFile[],
): Promise<MediaContent[]> {
  const type = kind === "pdf" ? "document" : "image";
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (total <= INLINE_LIMIT_BYTES) {
    return Promise.all(
      files.map(async (f) => ({
        type,
        mime_type: f.mimeType,
        data: (await readFile(f.path)).toString("base64"),
      })),
    );
  }
  const contents: MediaContent[] = [];
  for (const f of files) contents.push({ type, mime_type: f.mimeType, uri: await uploadFile(f) });
  return contents;
}

/** Dépose un fichier via la Files API (gratuite, conservé 48 h) et attend qu'il soit prêt. */
async function uploadFile(file: SourceFile): Promise<string> {
  const ai = gemini();
  let uploaded = await ai.files.upload({ file: file.path, config: { mimeType: file.mimeType } });
  for (let i = 0; uploaded.state === "PROCESSING" && uploaded.name && i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    uploaded = await ai.files.get({ name: uploaded.name });
  }
  if (uploaded.state === "FAILED" || uploaded.state === "PROCESSING" || !uploaded.uri) {
    throw new Error("Gemini n'a pas pu préparer le fichier source.");
  }
  return uploaded.uri;
}
