/** Constantes ajustables de l'assemblage (docs/SPEC.md §8.6). */
export const TTS_SAMPLE_RATE = 24_000;
/** Seuil prudent : en dessous, c'est du silence. Plus haut, on rognerait les attaques chuchotées. */
export const TRIM_THRESHOLD_DB = -60;
/** Marge de silence conservée de part et d'autre de la parole. */
export const TRIM_KEEP_SECONDS = 0.08;

/** Fondu aux deux bords d'un chunk : une coupe franche hors d'un passage à zéro claque. */
export const EDGE_FADE_SECONDS = 0.01;
/** Correction de niveau maximale d'un chunk vers le niveau médian du cours. */
export const LEVEL_MAX_DB = 4;
/** En dessous, l'écart ne s'entend pas : le chunk est laissé tel quel. */
export const LEVEL_MIN_DB = 0.5;

const PCM = ["-ar", String(TTS_SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le"] as const;

/**
 * Retire les silences de début et de fin d'un chunk, pour que les pauses insérées
 * ensuite soient exactes, puis adoucit ses bords. `areverse` permet de traiter la fin
 * comme un début. `volumedetect` écrit le niveau du résultat sur la sortie d'erreur.
 */
export function trimSilenceArgs(input: string, output: string): string[] {
  const edge = [
    `silenceremove=start_periods=1:start_threshold=${TRIM_THRESHOLD_DB}dB:start_silence=${TRIM_KEEP_SECONDS}`,
    `afade=t=in:d=${EDGE_FADE_SECONDS}`,
  ].join(",");
  return ["-i", input, "-af", `${edge},areverse,${edge},areverse,volumedetect`, ...PCM, output];
}

export type ChunkLevel = { meanDb: number; maxDb: number };

/** Lit le rapport de `volumedetect`. `null` pour un chunk muet ou un rapport absent. */
export function parseVolume(stderr: string): ChunkLevel | null {
  const meanDb = Number(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr)?.[1]);
  const maxDb = Number(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr)?.[1]);
  return Number.isFinite(meanDb) && Number.isFinite(maxDb) ? { meanDb, maxDb } : null;
}

/**
 * Gain à appliquer à chaque chunk pour le ramener au niveau médian : chaque appel TTS a
 * son propre niveau, et le master n'applique qu'un gain global. Borné, et jamais au point
 * d'écrêter. 0 = chunk laissé tel quel.
 */
export function levelGainsDb(levels: readonly (ChunkLevel | null)[]): number[] {
  const means = levels.flatMap((l) => (l ? [l.meanDb] : [])).sort((a, b) => a - b);
  const median = means[Math.floor(means.length / 2)];
  if (median === undefined) return levels.map(() => 0);
  return levels.map((level) => {
    if (!level) return 0;
    const wanted = Math.min(LEVEL_MAX_DB, Math.max(-LEVEL_MAX_DB, median - level.meanDb));
    const gain = Math.min(wanted, -1 - level.maxDb);
    return Math.abs(gain) < LEVEL_MIN_DB ? 0 : Number(gain.toFixed(1));
  });
}

export function gainArgs(input: string, output: string, gainDb: number): string[] {
  return ["-i", input, "-af", `volume=${gainDb.toFixed(1)}dB`, ...PCM, output];
}

/** Silence de durée exacte, au format des chunks (concaténable en `-c copy`). */
export function silenceArgs(durationMs: number, output: string): string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${TTS_SAMPLE_RATE}:cl=mono`,
    "-t",
    (durationMs / 1000).toFixed(3),
    ...PCM,
    output,
  ];
}

/** Concaténation sans réencodage (concat demuxer) : tous les fichiers ont le même format. */
export function concatArgs(listFile: string, output: string): string[] {
  return ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output];
}

/** Contenu du fichier de liste du concat demuxer. */
export function concatList(paths: readonly string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}
