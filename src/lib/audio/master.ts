/** Constantes ajustables du mastering voix (docs/SPEC.md §8.7). */
export const MASTER = {
  highpassHz: 70,
  /** Indispensable : le chuchoté synthétique siffle sur les « s ». */
  deesserIntensity: 0.4,
  compressor: { thresholdDb: -24, ratio: 2, attackMs: 15, releaseMs: 200 },
  warmth: { frequencyHz: 160, q: 1, gainDb: 1.5 },
  loudness: { integratedLufs: -19, truePeakDb: -2, range: 7 },
  sampleRate: 48_000,
  voiceBitrate: "96k",
} as const;

export function masterFilter(): string {
  const { compressor: c, warmth: w, loudness: l } = MASTER;
  return [
    `highpass=f=${MASTER.highpassHz}`,
    `deesser=i=${MASTER.deesserIntensity}`,
    `acompressor=threshold=${c.thresholdDb}dB:ratio=${c.ratio}:attack=${c.attackMs}:release=${c.releaseMs}`,
    `equalizer=f=${w.frequencyHz}:t=q:w=${w.q}:g=${w.gainDb}`,
    `loudnorm=I=${l.integratedLufs}:TP=${l.truePeakDb}:LRA=${l.range}`,
    // loudnorm sort en 192 kHz : le retour à 48 kHz est obligatoire.
    `aresample=${MASTER.sampleRate}`,
  ].join(",");
}

/** 1) Master voix → WAV intermédiaire (évite un double encodage avec perte). */
export function masterArgs(input: string, output: string): string[] {
  return ["-i", input, "-af", masterFilter(), "-ac", "1", output];
}

/** 2) Voix seule en AAC avec chapitres, pour le mix en direct dans le lecteur. */
export function encodeVoiceArgs(master: string, chaptersMeta: string, output: string): string[] {
  return [
    "-i",
    master,
    "-f",
    "ffmetadata",
    "-i",
    chaptersMeta,
    "-map",
    "0:a",
    "-map_chapters",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    MASTER.voiceBitrate,
    "-movflags",
    "+faststart",
    output,
  ];
}
