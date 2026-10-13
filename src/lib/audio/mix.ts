/** Constantes ajustables du pré-mix (docs/SPEC.md §8.7). */
export const MIX = {
  ambienceFadeInSeconds: 8,
  fadeOutSeconds: 12,
  bitrate: "128k",
} as const;

export type MixOptions = {
  master: string;
  ambience: string;
  chaptersMeta: string;
  output: string;
  /** Gain appliqué à l'ambiance, en dB. */
  ambienceGainDb: number;
  /** Durée de la voix : le fondu final se cale dessus. */
  durationMs: number;
};

export function mixFilter(ambienceGainDb: number, durationMs: number): string {
  const fadeStart = Math.max(0, durationMs / 1000 - MIX.fadeOutSeconds);
  return [
    // Le master est déjà stéréo quand la voix se balance ; un master mono est dédoublé.
    "[0:a]aformat=channel_layouts=stereo[v]",
    `[1:a]volume=${ambienceGainDb.toFixed(1)}dB,afade=t=in:d=${MIX.ambienceFadeInSeconds}[bg]`,
    `[v][bg]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${fadeStart.toFixed(3)}:d=${MIX.fadeOutSeconds}[out]`,
  ].join(";");
}

/** 3) Pré-mix voix + ambiance en boucle, pour l'écran verrouillé et le hors-ligne. */
export function mixArgs(o: MixOptions): string[] {
  return [
    "-i",
    o.master,
    "-stream_loop",
    "-1",
    "-i",
    o.ambience,
    "-f",
    "ffmetadata",
    "-i",
    o.chaptersMeta,
    "-filter_complex",
    mixFilter(o.ambienceGainDb, o.durationMs),
    "-map",
    "[out]",
    "-map_chapters",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    MIX.bitrate,
    "-movflags",
    "+faststart",
    o.output,
  ];
}

export type NoiseColor = "pink" | "brown" | "white";

/** Lit d'ambiance synthétique (bruit coloré), sans fichier source. */
export function noiseBedArgs(
  output: string,
  opts: { color: NoiseColor; seconds: number; filter?: string; codec: "flac" | "aac" },
): string[] {
  const chain = [opts.filter, "loudnorm=I=-28:TP=-3:LRA=7", "aresample=48000"]
    .filter(Boolean)
    .join(",");
  return [
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=${opts.color}:r=48000:a=0.5:d=${opts.seconds}`,
    "-af",
    chain,
    "-ac",
    "2",
    ...(opts.codec === "flac"
      ? ["-c:a", "flac"]
      : ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
    output,
  ];
}
