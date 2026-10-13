export const VOICE_PRESETS_VERSION = "voices-v1";

export type VoicePreset = { slug: string; label: string; description: string };

/**
 * Presets de voice design (§9.4), à créer dans chaque projet Gemini par `pnpm voices:seed`.
 * Descriptions en anglais ; la spec demande d'essayer aussi le français et de garder
 * ce qui sonne le mieux (`pnpm voices:seed --fr`).
 */
export const VOICE_PRESETS: readonly VoicePreset[] = [
  {
    slug: "murmure-doux",
    label: "Murmure doux",
    description:
      "A calm young adult French woman from Paris. Soft, breathy, intimate whisper, very close to the microphone. Slow, warm and reassuring pacing, clear articulation, no vocal fry.",
  },
  {
    slug: "murmure-grave",
    label: "Murmure grave",
    description:
      "A calm adult French man. Low, soft, breathy whisper, very close to the microphone. Slow, warm and reassuring, clear articulation, no vocal fry.",
  },
];

export const VOICE_PRESETS_FR: readonly VoicePreset[] = [
  {
    slug: "murmure-doux",
    label: "Murmure doux",
    description:
      "Une jeune femme française de Paris, calme. Chuchotement doux, soufflé et intime, tout près du micro. Débit lent, chaleureux et rassurant, articulation nette, sans voix craquée.",
  },
  {
    slug: "murmure-grave",
    label: "Murmure grave",
    description:
      "Un homme français adulte, calme. Chuchotement grave, doux et soufflé, tout près du micro. Lent, chaleureux et rassurant, articulation nette, sans voix craquée.",
  },
];

/** Voix Gemini prédéfinies, gratuites à ajouter : de quoi lancer un cours avant tout voice design. */
export const PREBUILT_VOICES: readonly { id: string; label: string; description: string }[] = [
  { id: "Achernar", label: "Achernar", description: "Voix prédéfinie Gemini, douce." },
  { id: "Enceladus", label: "Encelade", description: "Voix prédéfinie Gemini, soufflée." },
];

/** Texte d'aperçu fixe, identique pour toutes les voix. */
export const VOICE_PREVIEW_SEGMENTS = [
  { text: "Installe-toi confortablement…", pauseAfterMs: 400, breathBefore: false },
  {
    text: "Aujourd'hui, on revoit ensemble les bases du cours, tranquillement, une idée après l'autre.",
    pauseAfterMs: 400,
    breathBefore: true,
  },
] as const;
