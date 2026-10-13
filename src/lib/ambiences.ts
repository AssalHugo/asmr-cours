import type { NoiseColor } from "@/lib/audio/mix";

export type Ambience = {
  id: string;
  label: string;
  /** Gain par défaut appliqué au fichier normalisé à −28 LUFS, en dB. */
  defaultGainDb: number;
  /** Lit synthétique : seule ambiance réelle pour le bruit rose, simple doublure en mode mock. */
  synth: { color: NoiseColor; filter?: string };
};

/**
 * Ambiances en boucle (docs/SPEC.md §1). Les fichiers CC0 sont préparés par
 * `pnpm ambience:prepare` puis envoyés par `pnpm ambience:upload` ; le bruit rose
 * est synthétisé par FFmpeg et n'a besoin d'aucun fichier.
 */
export const AMBIENCES: readonly Ambience[] = [
  {
    id: "rain",
    label: "Pluie",
    defaultGainDb: -4,
    synth: { color: "pink", filter: "highpass=f=400" },
  },
  {
    id: "library",
    label: "Bibliothèque",
    defaultGainDb: -6,
    synth: { color: "brown", filter: "lowpass=f=900" },
  },
  {
    id: "fireplace",
    label: "Cheminée",
    defaultGainDb: -5,
    synth: { color: "brown", filter: "lowpass=f=1800" },
  },
  {
    id: "lofi",
    label: "Lofi",
    defaultGainDb: -8,
    synth: { color: "pink", filter: "lowpass=f=3000" },
  },
  { id: "pink-noise", label: "Bruit rose", defaultGainDb: -6, synth: { color: "pink" } },
];

export const SYNTHETIC_AMBIENCE_ID = "pink-noise";
export const AMBIENCE_GAIN_RANGE = { min: -18, max: 6 } as const;

export function getAmbience(id: string): Ambience | undefined {
  return AMBIENCES.find((a) => a.id === id);
}

export function isAmbienceId(id: string): boolean {
  return AMBIENCES.some((a) => a.id === id);
}
