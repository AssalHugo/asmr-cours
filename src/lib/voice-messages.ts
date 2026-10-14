import { z } from "zod";

/** Messages vocaux laissés par un compte admin dans un cours (lus une seule fois). */

export const MAX_MESSAGE_MS = 3 * 60_000;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** Types acceptés, sans paramètres de codec → extension de la clé de stockage. */
export const VOICE_MESSAGE_MIME: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

/**
 * Formats d'enregistrement, du préféré au moins bon : l'AAC en MP4 se lit partout
 * (Safari compris), le WebM Opus de Firefox ne passe pas sur les vieux iPhone.
 */
export const RECORDER_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

export const baseMime = (mime: string) => mime.split(";")[0]?.trim().toLowerCase() ?? "";

export function messageExtension(mime: string): string | undefined {
  return VOICE_MESSAGE_MIME[baseMime(mime)];
}

export function pickRecorderMime(isSupported: (mime: string) => boolean): string | undefined {
  return RECORDER_MIME_CANDIDATES.find((mime) => isSupported(mime));
}

const Mime = z
  .string()
  .max(100)
  .refine((m) => messageExtension(m) !== undefined, "Format audio non pris en charge.");

export const PrepareMessageInput = z.object({
  courseId: z.uuid(),
  mime: Mime,
  bytes: z.number().int().positive().max(MAX_MESSAGE_BYTES),
});
export type PrepareMessageInput = z.infer<typeof PrepareMessageInput>;

export const CreateMessageInput = z.object({
  courseId: z.uuid(),
  messageId: z.uuid(),
  mime: Mime,
  durationMs: z.number().int().positive().max(MAX_MESSAGE_MS),
  /** `null` : au lancement du cours. */
  atMs: z.number().int().min(0).nullable(),
});
export type CreateMessageInput = z.infer<typeof CreateMessageInput>;

export type PendingMessage = { id: string; atMs: number | null; durationMs: number };

/**
 * Message à jouer maintenant, pendant la lecture : d'abord ceux du lancement, puis le premier
 * moment atteint. Un moment déjà dépassé (reprise plus loin, saut) se joue quand même :
 * chaque message doit être entendu une fois.
 */
export function dueMessage(
  pending: readonly PendingMessage[],
  positionMs: number,
): PendingMessage | undefined {
  const launch = pending.find((m) => m.atMs === null);
  if (launch) return launch;
  return pending
    .filter((m) => m.atMs !== null && m.atMs <= positionMs)
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0))[0];
}

/** « 12:30 » ou « 1:02:07 » → millisecondes ; `null` si illisible. */
export function parseClock(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, ...nums];
  if (m === undefined || s === undefined || h === undefined || m > 59 || s > 59) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}
