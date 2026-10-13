import type { VoiceMode } from "@/lib/estimate";

export const VOICE_PRESETS_VERSION = "voices-v2";

export type VoicePreset = {
  slug: string;
  label: string;
  /** Mode pour lequel la voix est conçue : un chuchotement ne fait pas une bonne voix douce. */
  mode: VoiceMode;
  gender: "female" | "male";
  description: string;
};

/**
 * Presets de voice design (§9.4), à créer dans chaque projet Gemini par `pnpm voices:seed`.
 * Règles de la doc Gemini (voice design) : une ou deux phrases, traits permanents seulement
 * (âge, timbre, texture, accent, débit de base). L'émotion du moment va dans le style, et une
 * description longue ou contradictoire rend la voix moins stable.
 * Une voix par mode : le timbre est dans la voix, si bien que le rendu tient aussi en Éco,
 * où le style par tour n'existe pas.
 * Descriptions en anglais ; la spec demande d'essayer aussi le français et de garder
 * ce qui sonne le mieux (`pnpm voices:seed --fr`).
 */
export const VOICE_PRESETS: readonly VoicePreset[] = [
  {
    slug: "murmure-doux",
    label: "Murmure doux",
    mode: "whisper",
    gender: "female",
    description:
      "A Parisian woman in her late twenties with a light, airy voice, whispering without voicing, very close to the microphone. Unhurried and even, with soft consonants and gently falling intonation.",
  },
  {
    slug: "murmure-grave",
    label: "Murmure grave",
    mode: "whisper",
    gender: "male",
    description:
      "A French man in his thirties with a low, velvety voice, whispering without voicing, very close to the microphone. Unhurried and even, with soft consonants and gently falling intonation.",
  },
  {
    slug: "voix-douce",
    label: "Voix douce",
    mode: "soft",
    gender: "female",
    description:
      "A Parisian woman in her early thirties with a warm, slightly husky voice, speaking softly at low volume, very close to the microphone. Unhurried and even, never projecting, with gently falling intonation.",
  },
  {
    slug: "voix-douce-grave",
    label: "Voix douce grave",
    mode: "soft",
    gender: "male",
    description:
      "A French man in his thirties with a deep, warm voice, speaking softly at low volume, very close to the microphone. Unhurried and even, never projecting, with gently falling intonation.",
  },
];

export const VOICE_PRESETS_FR: readonly VoicePreset[] = [
  {
    slug: "murmure-doux",
    label: "Murmure doux",
    mode: "whisper",
    gender: "female",
    description:
      "Une Parisienne proche de la trentaine, voix légère et aérienne, qui chuchote sans voiser, tout près du micro. Débit posé et régulier, consonnes douces, intonation qui retombe doucement.",
  },
  {
    slug: "murmure-grave",
    label: "Murmure grave",
    mode: "whisper",
    gender: "male",
    description:
      "Un Français d'une trentaine d'années, voix grave et veloutée, qui chuchote sans voiser, tout près du micro. Débit posé et régulier, consonnes douces, intonation qui retombe doucement.",
  },
  {
    slug: "voix-douce",
    label: "Voix douce",
    mode: "soft",
    gender: "female",
    description:
      "Une Parisienne d'une trentaine d'années, voix chaude et légèrement voilée, qui parle bas et doucement, tout près du micro. Débit posé et régulier, sans jamais projeter, intonation qui retombe doucement.",
  },
  {
    slug: "voix-douce-grave",
    label: "Voix douce grave",
    mode: "soft",
    gender: "male",
    description:
      "Un Français d'une trentaine d'années, voix profonde et chaude, qui parle bas et doucement, tout près du micro. Débit posé et régulier, sans jamais projeter, intonation qui retombe doucement.",
  },
];

/**
 * Voix Gemini prédéfinies, gratuites à ajouter : de quoi lancer un cours avant tout voice
 * design. Choisies dans le catalogue officiel pour leur caractère (entre parenthèses dans
 * la doc) ; `pnpm voices:list` montre les autres candidates.
 */
export const PREBUILT_VOICES: readonly { id: string; label: string; description: string }[] = [
  { id: "Achernar", label: "Achernar", description: "Voix prédéfinie Gemini, douce." },
  { id: "Enceladus", label: "Encelade", description: "Voix prédéfinie Gemini, soufflée." },
  { id: "Vindemiatrix", label: "Vindemiatrix", description: "Voix prédéfinie Gemini, délicate." },
  { id: "Sulafat", label: "Sulafat", description: "Voix prédéfinie Gemini, chaleureuse." },
];

/**
 * Texte d'aperçu fixe, identique pour toutes les voix : une vingtaine de secondes, avec ce
 * qui trahit une voix (sifflantes, chiffre, terme technique, question).
 */
export const VOICE_PREVIEW_SEGMENTS = [
  { text: "Installe-toi confortablement…", pauseAfterMs: 700, breathBefore: false },
  {
    text: "Aujourd'hui, on revoit ensemble les bases du cours, tranquillement, une idée après l'autre.",
    pauseAfterMs: 700,
    breathBefore: true,
  },
  {
    text: "La photosynthèse se déroule en deux phases, dans les chloroplastes des cellules végétales.",
    pauseAfterMs: 400,
    breathBefore: false,
  },
  {
    text: "Elle consomme six molécules de dioxyde de carbone, et produit du glucose et du dioxygène.",
    pauseAfterMs: 700,
    breathBefore: false,
  },
  {
    text: "Tu vois ? Ce n'est pas si compliqué. On reprend doucement, sans se presser.",
    pauseAfterMs: 400,
    breathBefore: false,
  },
] as const;
