import { z } from "zod";
import { UPLOAD_MIME } from "@/lib/uploads";

/**
 * Accès limité aux fichiers que la personne choisit dans le sélecteur : l'app ne voit
 * rien d'autre de son Drive, et ce scope ne demande pas de validation par Google.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/** Documents Google sans fichier derrière : Drive les convertit en PDF à la demande. */
const EXPORTED_AS_PDF: readonly string[] = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
];

export type DriveKind = keyof typeof UPLOAD_MIME;

export type DriveConfig = { clientId: string; apiKey: string; appId: string };

/**
 * Réglages du sélecteur, ou `null` si l'import Drive n'est pas configuré. L'identifiant
 * d'application attendu par le sélecteur est le numéro de projet, préfixe du client OAuth.
 */
export function driveConfig(env: {
  NEXT_PUBLIC_GOOGLE_CLIENT_ID?: string;
  NEXT_PUBLIC_GOOGLE_API_KEY?: string;
}): DriveConfig | null {
  const clientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const apiKey = env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const appId = clientId ? /^(\d+)-/.exec(clientId)?.[1] : undefined;
  return clientId && apiKey && appId ? { clientId, apiKey, appId } : null;
}

/** Types proposés dans le sélecteur pour une nature de source. */
export function drivePickerMimeTypes(kind: DriveKind): string[] {
  const direct = Object.keys(UPLOAD_MIME[kind]);
  return kind === "pdf" ? [...direct, ...EXPORTED_AS_PDF] : direct;
}

/** Un fichier renvoyé par le sélecteur (seuls les champs utiles). */
export const DrivePick = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  mimeType: z.string(),
  sizeBytes: z.coerce.number().nonnegative().optional().catch(undefined),
});
export type DrivePick = z.infer<typeof DrivePick>;

export const DrivePickerResult = z.object({
  action: z.string(),
  docs: z.array(DrivePick).optional(),
});
export type DrivePickerResult = z.infer<typeof DrivePickerResult>;

export type DriveDownload = { url: string; type: string; name: string };

/** Où télécharger un fichier choisi et sous quel type le déposer ; `null` s'il n'est pas accepté. */
export function driveDownload(kind: DriveKind, pick: DrivePick): DriveDownload | null {
  const id = encodeURIComponent(pick.id);
  const mimeType = pick.mimeType.toLowerCase();
  const name = pick.name.trim() || "Sans titre";
  if (kind === "pdf" && EXPORTED_AS_PDF.includes(mimeType)) {
    const clean = name.replace(/\.pdf$/i, "").trim() || "Sans titre";
    return {
      url: `${DRIVE_API}/${id}/export?mimeType=application%2Fpdf`,
      type: "application/pdf",
      // Le titre du cours est tiré du nom du fichier, borné à 200 caractères côté serveur.
      name: `${clean.slice(0, 190)}.pdf`,
    };
  }
  if (!(mimeType in UPLOAD_MIME[kind])) return null;
  return { url: `${DRIVE_API}/${id}?alt=media`, type: mimeType, name: name.slice(0, 200) };
}
