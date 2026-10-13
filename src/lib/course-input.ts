import { z } from "zod";
import { AMBIENCE_GAIN_RANGE, isAmbienceId } from "@/lib/ambiences";

const ambience = z.string().refine(isAmbienceId, "Ambiance inconnue");
const gainDb = z.number().min(AMBIENCE_GAIN_RANGE.min).max(AMBIENCE_GAIN_RANGE.max);

/** Source déposée (étape 1 de l'assistant). */
export const SourceInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(200, "Colle au moins quelques phrases de cours."),
  }),
  z.object({
    kind: z.enum(["pdf", "images"]),
    courseId: z.uuid(),
    keys: z.array(z.string()).min(1).max(30),
    fileName: z.string().max(200).optional(),
  }),
]);
export type SourceInput = z.infer<typeof SourceInput>;

/** Réglages et lancement (étapes 2 et 3). */
export const CreateCourseInput = z.object({
  courseId: z.uuid(),
  source: z.object({
    kind: z.enum(["pdf", "images", "text"]),
    keys: z.array(z.string()).min(1).max(30),
  }),
  title: z.string().trim().min(1, "Donne un titre à ce cours.").max(200),
  titleIsDefault: z.boolean(),
  mode: z.enum(["whisper", "soft"]),
  voiceId: z.uuid(),
  ambience,
  ambienceGainDb: gainDb,
  addressForm: z.enum(["tu", "vous"]),
  tier: z.enum(["eco", "express"]),
  quality: z.enum(["standard", "economy"]),
  /** Confirmation explicite du dépassement des 80 % du budget. */
  confirmed: z.boolean(),
});
export type CreateCourseInput = z.infer<typeof CreateCourseInput>;

export const RemixInput = z.object({ courseId: z.uuid(), ambience, ambienceGainDb: gainDb });

export const ShareInput = z.object({
  courseId: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email("Cette adresse e-mail n'est pas valide.")),
});

export const SettingsInput = z.object({
  displayName: z.string().trim().max(80),
  defaultVoiceId: z.uuid().nullable(),
  defaultMode: z.enum(["whisper", "soft"]),
  defaultAmbience: ambience,
  defaultTier: z.enum(["eco", "express"]),
  defaultQuality: z.enum(["standard", "economy"]),
  addressForm: z.enum(["tu", "vous"]),
  monthlyBudgetUsd: z.number().min(0).max(500),
});
export type SettingsInput = z.infer<typeof SettingsInput>;

export const VoiceDesignInput = z.object({
  description: z.string().trim().min(20, "Décris la voix en une ou deux phrases.").max(600),
});

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; message: string; reason?: string };

export const fail = (
  message: string,
  reason?: string,
): { ok: false; message: string; reason?: string } => ({
  ok: false,
  message,
  reason,
});
