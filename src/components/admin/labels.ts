/** Libellés du mode admin. */

export const STEP_LABEL: Record<string, string> = {
  extract: "Lecture du cours",
  rewrite: "Écriture du script",
  verify: "Contrôle de fidélité",
  tts: "Voix",
  "redo-chunk": "Passage refait",
  "voice-design": "Création de voix",
  "voice-sample": "Échantillon de voix",
};

export const stepLabel = (step: string) => STEP_LABEL[step] ?? step;

export const TIER_LABEL: Record<string, string> = {
  eco: "Éco",
  express: "Express",
  batch: "Batch",
  standard: "Standard",
};

export const QUALITY_LABEL: Record<string, string> = { standard: "Standard", economy: "Économie" };
export const MODE_LABEL: Record<string, string> = { whisper: "Chuchoté", soft: "Doux" };
export const SOURCE_LABEL: Record<string, string> = {
  pdf: "PDF",
  images: "Photos",
  text: "Texte collé",
};
