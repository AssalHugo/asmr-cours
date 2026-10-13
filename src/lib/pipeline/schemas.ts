import { z } from "zod";

/** Bornes de taille d'une section après post-traitement (docs/SPEC.md §8.1). */
export const SECTION_MIN_CHARS = 1500;
export const SECTION_MAX_CHARS = 6000;

/**
 * Sortie de l'extraction. Écart assumé avec la spec : `content` n'impose pas 200 caractères
 * minimum, sinon un intertitre isolé ferait échouer tout le cours. Les sections trop
 * courtes sont fusionnées par `normalizeSections`.
 */
export const ExtractedCourse = z.object({
  title: z.string().min(1).max(200),
  language: z.string(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        content: z.string().min(1),
        keyTerms: z.array(z.string()).max(12),
        keyFacts: z.array(z.string()).max(15),
      }),
    )
    .min(1),
});
export type ExtractedCourse = z.infer<typeof ExtractedCourse>;
export type ExtractedSection = ExtractedCourse["sections"][number];

export const Segment = z.object({
  text: z.string().min(1).max(400),
  pauseAfterMs: z.number().int().min(200).max(3500),
  breathBefore: z.boolean(),
});
export type Segment = z.infer<typeof Segment>;

export const Script = z.object({ segments: z.array(Segment).min(1) });
export type Script = z.infer<typeof Script>;

export const VerifyReport = z.object({
  ok: z.boolean(),
  missingFacts: z.array(z.string()),
  alteredFacts: z.array(z.string()),
  inventedClaims: z.array(z.string()),
});
export type VerifyReport = z.infer<typeof VerifyReport>;

export const SCRIPT_MIN_RATIO = 0.9;
export const SCRIPT_MAX_RATIO = 1.4;

// Markdown, crochets, chevrons, accolades : tout ce que le TTS lirait mot à mot ou
// prendrait pour une balise.
const FORBIDDEN_CHARS = /[*_#`~|[\]<>{}]/;
const EMOJI = /\p{Extended_Pictographic}/u;

export const scriptChars = (script: Script) =>
  script.segments.reduce((sum, s) => sum + s.text.length, 0);

/** Contrôles côté code du script réécrit (§8.2). Liste vide = script accepté. */
export function scriptProblems(script: Script, sourceChars: number): string[] {
  const problems: string[] = [];
  script.segments.forEach((segment, index) => {
    if (FORBIDDEN_CHARS.test(segment.text)) {
      problems.push(`Segment ${index + 1} : markdown, crochet ou chevron interdit.`);
    }
    if (EMOJI.test(segment.text)) problems.push(`Segment ${index + 1} : emoji interdit.`);
  });
  const ratio = scriptChars(script) / Math.max(1, sourceChars);
  if (ratio < SCRIPT_MIN_RATIO || ratio > SCRIPT_MAX_RATIO) {
    problems.push(
      `Longueur totale de ${ratio.toFixed(2)} fois la source : elle doit rester entre ${SCRIPT_MIN_RATIO} et ${SCRIPT_MAX_RATIO}.`,
    );
  }
  return problems;
}

/** Le rapport est cohérent : `ok` n'est vrai que si les trois listes sont vides. */
export function reportIsClean(report: VerifyReport): boolean {
  return (
    report.ok &&
    report.missingFacts.length === 0 &&
    report.alteredFacts.length === 0 &&
    report.inventedClaims.length === 0
  );
}

/** Charges utiles des tâches Trigger.dev. */
export const GenerateCoursePayload = z.object({
  courseId: z.uuid(),
  userId: z.uuid(),
  /** Le titre vient du nom de fichier : l'extraction peut le remplacer. */
  titleIsDefault: z.boolean().default(false),
});
export type GenerateCoursePayload = z.infer<typeof GenerateCoursePayload>;

export const RegenerateSectionPayload = z.object({
  courseId: z.uuid(),
  userId: z.uuid(),
  sectionId: z.uuid(),
});
export type RegenerateSectionPayload = z.infer<typeof RegenerateSectionPayload>;

export const RemixPayload = z.object({
  courseId: z.uuid(),
  userId: z.uuid(),
  ambience: z.string().min(1),
  ambienceGainDb: z.number().min(-30).max(12),
});
export type RemixPayload = z.infer<typeof RemixPayload>;

export const VoiceSamplePayload = z.object({
  voiceId: z.uuid(),
  userId: z.uuid(),
  mode: z.enum(["whisper", "soft"]),
});
export type VoiceSamplePayload = z.infer<typeof VoiceSamplePayload>;

export const Chapter = z.object({
  title: z.string(),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type Chapter = z.infer<typeof Chapter>;

export const Caption = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type Caption = z.infer<typeof Caption>;
