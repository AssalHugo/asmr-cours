/** Constantes ajustables de l'assemblage (docs/SPEC.md §8.6). */
export const TTS_SAMPLE_RATE = 24_000;
/** Seuil prudent : en dessous, c'est du silence. Plus haut, on rognerait les attaques chuchotées. */
export const TRIM_THRESHOLD_DB = -60;
/** Marge de silence conservée de part et d'autre de la parole. */
export const TRIM_KEEP_SECONDS = 0.08;

const PCM = ["-ar", String(TTS_SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le"] as const;

/**
 * Retire les silences de début et de fin d'un chunk, pour que les pauses insérées
 * ensuite soient exactes. `areverse` permet de traiter la fin comme un début.
 */
export function trimSilenceArgs(input: string, output: string): string[] {
  const trim = `silenceremove=start_periods=1:start_threshold=${TRIM_THRESHOLD_DB}dB:start_silence=${TRIM_KEEP_SECONDS}`;
  return ["-i", input, "-af", `${trim},areverse,${trim},areverse`, ...PCM, output];
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
