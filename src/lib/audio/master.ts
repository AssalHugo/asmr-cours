/** Constantes ajustables du mastering voix (docs/SPEC.md §8.7). */
export const MASTER: {
  highpassHz: number;
  deesserIntensity: number;
  compressor: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number };
  warmth: { frequencyHz: number; q: number; gainDb: number };
  loudness: { integratedLufs: number; truePeakDb: number; range: number };
  stereoDrift: { hz: number; amount: number } | null;
  roomToneDb: number | null;
  sampleRate: number;
  voiceBitrate: string;
} = {
  highpassHz: 70,
  /** Indispensable : le chuchoté synthétique siffle sur les « s ». */
  deesserIntensity: 0.4,
  compressor: { thresholdDb: -24, ratio: 2, attackMs: 15, releaseMs: 200 },
  warmth: { frequencyHz: 160, q: 1, gainDb: 1.5 },
  loudness: { integratedLufs: -19, truePeakDb: -2, range: 7 },
  /**
   * Balancement lent et discret d'une oreille à l'autre : la voix du TTS est mono, celle
   * d'une vidéo ASMR ne l'est jamais. Appliqué après la mise au niveau, il retire environ
   * 1 LU à la piste. `null` garde une voix centrée, en mono.
   */
  stereoDrift: { hz: 0.04, amount: 0.25 },
  /**
   * Fond de pièce continu sous la voix, en dB RMS. Sans lui, chaque pause tombe au silence
   * numérique et la voix semble passer par une porte de bruit. `null` le retire.
   */
  roomToneDb: -62,
  sampleRate: 48_000,
  voiceBitrate: "96k",
};

/** Niveau RMS du bruit rose d'`anoisesrc` à pleine amplitude, mesuré avec `volumedetect`. */
const PINK_NOISE_RMS_DB = -14.3;

export const masterChannels = () => (MASTER.stereoDrift ? 2 : 1);

/** Mesures de la première passe de `loudnorm`. */
export type LoudnessMeasure = {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
};

/** Timbre, avant la mise au niveau : identique dans les deux passes. */
export function toneFilter(): string {
  const { compressor: c, warmth: w } = MASTER;
  return [
    `highpass=f=${MASTER.highpassHz}`,
    `deesser=i=${MASTER.deesserIntensity}`,
    `acompressor=threshold=${c.thresholdDb}dB:ratio=${c.ratio}:attack=${c.attackMs}:release=${c.releaseMs}`,
    `equalizer=f=${w.frequencyHz}:t=q:w=${w.q}:g=${w.gainDb}`,
  ].join(",");
}

/**
 * Mise au niveau. Avec les mesures d'une première passe, `loudnorm` applique un gain fixe
 * (`linear`) : en une seule passe il ajuste le gain au fil de l'eau et pompe sur du chuchoté.
 * La plage visée s'élargit jusqu'à celle mesurée, sans quoi il reviendrait au mode dynamique.
 */
function loudnormFilter(measure?: LoudnessMeasure): string {
  const { integratedLufs: i, truePeakDb: tp, range } = MASTER.loudness;
  if (!measure) return `loudnorm=I=${i}:TP=${tp}:LRA=${range}`;
  const lra = Math.min(50, Math.max(range, Math.ceil(measure.inputLra)));
  return [
    `loudnorm=I=${i}:TP=${tp}:LRA=${lra}`,
    `measured_I=${measure.inputI}`,
    `measured_TP=${measure.inputTp}`,
    `measured_LRA=${measure.inputLra}`,
    `measured_thresh=${measure.inputThresh}`,
    `offset=${measure.targetOffset}`,
    "linear=true",
  ].join(":");
}

export function masterFilter(measure?: LoudnessMeasure): string {
  const s = MASTER.stereoDrift;
  return [
    toneFilter(),
    loudnormFilter(measure),
    // loudnorm sort en 192 kHz : le retour à 48 kHz est obligatoire.
    `aresample=${MASTER.sampleRate}`,
    // La stéréo vient après la mise au niveau : loudnorm coûte le double sur deux canaux.
    ...(s
      ? [
          "aformat=channel_layouts=stereo",
          `apulsator=mode=sine:hz=${s.hz}:amount=${s.amount}:offset_l=0:offset_r=0.5`,
        ]
      : []),
  ].join(",");
}

/** Graphe complet : la voix masterisée, posée sur son fond de pièce. */
export function masterGraph(measure?: LoudnessMeasure): string {
  const voice = `[0:a]${masterFilter(measure)}`;
  if (MASTER.roomToneDb === null) return `${voice}[out]`;
  const noise = (seed: number) => `anoisesrc=color=pink:r=${MASTER.sampleRate}:a=1:seed=${seed}`;
  const level = `volume=${(MASTER.roomToneDb - PINK_NOISE_RMS_DB).toFixed(1)}dB`;
  // En stéréo, deux bruits indépendants : un même bruit des deux côtés sonnerait au centre.
  const bed = MASTER.stereoDrift
    ? `${noise(7)}[nl];${noise(11)}[nr];[nl][nr]amerge=inputs=2,${level}[bed]`
    : `${noise(7)},${level}[bed]`;
  return `${voice}[v];${bed};[v][bed]amix=inputs=2:duration=first:normalize=0[out]`;
}

/** Première passe : mesure la sonie de la voix traitée, sans rien écrire. */
export function measureLoudnessArgs(input: string): string[] {
  const { integratedLufs: i, truePeakDb: tp, range } = MASTER.loudness;
  const measure = `loudnorm=I=${i}:TP=${tp}:LRA=${range}:print_format=json`;
  return ["-i", input, "-af", `${toneFilter()},${measure}`, "-f", "null", "-"];
}

/** Lit le rapport JSON de `loudnorm`. `null` s'il manque ou si la piste est muette. */
export function parseLoudness(stderr: string): LoudnessMeasure | null {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const measure = {
    inputI: Number(report.input_i),
    inputTp: Number(report.input_tp),
    inputLra: Number(report.input_lra),
    inputThresh: Number(report.input_thresh),
    targetOffset: Number(report.target_offset),
  };
  return Object.values(measure).every(Number.isFinite) ? measure : null;
}

/**
 * 1) Master voix → WAV intermédiaire (évite un double encodage avec perte). Sans mesure,
 * `loudnorm` travaille en une passe.
 */
export function masterArgs(input: string, output: string, measure?: LoudnessMeasure): string[] {
  return [
    "-i",
    input,
    "-filter_complex",
    masterGraph(measure),
    "-map",
    "[out]",
    "-ac",
    String(masterChannels()),
    output,
  ];
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
