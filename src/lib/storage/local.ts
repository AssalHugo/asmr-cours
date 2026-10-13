import "server-only";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ObjectStorage } from "./types";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function localContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Chemin disque d'une clé, confiné au répertoire racine. */
export function localPath(root: string, key: string): string {
  const base = resolve(root);
  const full = resolve(base, key);
  if (full !== base && !full.startsWith(base + sep)) throw new Error("Clé hors du stockage local");
  return full;
}

/**
 * Stockage sur disque pour le dev et les E2E (`STORAGE_MODE=local`).
 * Les « URLs présignées » pointent vers /api/dev-storage, protégé par la session.
 */
export function createLocalStorage(root: string, publicBase = "/api/dev-storage"): ObjectStorage {
  const urlFor = (key: string) =>
    `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    async put(key, body) {
      const path = localPath(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    get: (key) => readFile(localPath(root, key)),
    async head(key) {
      try {
        const info = await stat(localPath(root, key));
        return info.isFile() ? { bytes: info.size, contentType: localContentType(key) } : null;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(localPath(root, key), { force: true });
    },
    async deletePrefix(prefix) {
      const dir = localPath(root, prefix);
      if (prefix.endsWith("/")) {
        await rm(dir, { recursive: true, force: true });
        return;
      }
      const parent = dirname(dir);
      const names = await readdir(parent).catch(() => []);
      await Promise.all(
        names
          .filter((n) => join(parent, n).startsWith(dir))
          .map((n) => rm(join(parent, n), { recursive: true, force: true })),
      );
    },
    async uploadFile(path, key) {
      const target = localPath(root, key);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(path, target);
    },
    async downloadFile(key, path) {
      await copyFile(localPath(root, key), path);
    },
    async presignPut(key, { contentType }) {
      return { url: urlFor(key), headers: { "Content-Type": contentType } };
    },
    async presignGet(key) {
      return urlFor(key);
    },
  };
}
