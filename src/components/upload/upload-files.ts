import { PresignResponse, type PresignRequest } from "@/lib/uploads";

export type UploadProgress = { loaded: number; total: number };
export type UploadResult = { courseId: string; keys: string[] };

export class UploadError extends Error {}

/**
 * Envoie les fichiers directement du navigateur vers le stockage (URLs présignées),
 * dans l'ordre fourni. XMLHttpRequest plutôt que fetch : lui seul expose la progression.
 */
export async function uploadFiles(
  kind: PresignRequest["kind"],
  files: File[],
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
  /** Dépôt précédent du même brouillon, que le serveur efface. */
  replaces?: string,
): Promise<UploadResult> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      files: files.map((f) => ({ type: f.type, size: f.size })),
      replaces,
    } satisfies PresignRequest),
    signal,
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "L'envoi n'a pas pu démarrer.";
    throw new UploadError(message);
  }
  const { courseId, uploads } = PresignResponse.parse(body);

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const loaded = files.map(() => 0);
  const report = () => onProgress({ loaded: loaded.reduce((a, b) => a + b, 0), total });

  // Deux envois à la fois : assez pour 30 photos, sans saturer une connexion mobile.
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const target = uploads[index];
      if (!file || !target) throw new UploadError("Réponse d'upload incomplète.");
      await putWithProgress(target.url, target.headers, file, signal, (bytes) => {
        loaded[index] = bytes;
        report();
      });
    }
  }
  await Promise.all([worker(), worker()]);

  return { courseId, keys: uploads.map((u) => u.key) };
}

function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => onBytes(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onBytes(file.size);
        resolve();
      } else {
        reject(new UploadError(`L'envoi de « ${file.name} » a échoué (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new UploadError("Connexion interrompue pendant l'envoi."));
    xhr.onabort = () => reject(new UploadError("Envoi annulé."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
