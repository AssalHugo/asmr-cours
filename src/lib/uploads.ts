import { z } from "zod";

/** Types acceptés à l'upload, par nature de source. Extension = celle de la clé de stockage. */
export const UPLOAD_MIME = {
  pdf: { "application/pdf": "pdf" },
  /** Classeur : un gros PDF de plusieurs cours, découpé ensuite en leçons. */
  binder: { "application/pdf": "pdf" },
  images: {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  },
} as const satisfies Record<string, Record<string, string>>;

export const MAX_IMAGES = 30;

export const PresignRequest = z.object({
  kind: z.enum(["pdf", "images", "binder"]),
  files: z
    .array(
      z.object({
        type: z.string().min(1).max(100),
        size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(MAX_IMAGES),
  /** Dépôt précédent du même brouillon : ses fichiers sont effacés s'il n'a donné aucun cours. */
  replaces: z.uuid().optional(),
});
export type PresignRequest = z.infer<typeof PresignRequest>;

export const PresignResponse = z.object({
  courseId: z.uuid(),
  uploads: z.array(
    z.object({ key: z.string(), url: z.string(), headers: z.record(z.string(), z.string()) }),
  ),
});
export type PresignResponse = z.infer<typeof PresignResponse>;

export type UploadCheck = { ok: true; extensions: string[] } | { ok: false; message: string };

/** Contrôle serveur d'une demande d'upload : nombre, type MIME et taille de chaque fichier. */
export function checkUploadRequest(
  req: PresignRequest,
  limits: { maxUploadMb: number; maxBinderMb: number },
): UploadCheck {
  if (req.kind !== "images" && req.files.length !== 1) {
    return { ok: false, message: "Un seul PDF par cours." };
  }
  const allowed: Record<string, string> = UPLOAD_MIME[req.kind];
  const maxUploadMb = req.kind === "binder" ? limits.maxBinderMb : limits.maxUploadMb;
  const maxBytes = maxUploadMb * 1024 * 1024;
  const extensions: string[] = [];
  for (const file of req.files) {
    const ext = allowed[file.type.toLowerCase()];
    if (!ext) {
      return {
        ok: false,
        message:
          req.kind !== "images"
            ? "Ce fichier n'est pas un PDF."
            : "Format d'image non pris en charge (JPG, PNG, WEBP ou HEIC).",
      };
    }
    if (file.size > maxBytes) {
      return { ok: false, message: `Fichier trop lourd : ${maxUploadMb} Mo maximum.` };
    }
    extensions.push(ext);
  }
  return { ok: true, extensions };
}
