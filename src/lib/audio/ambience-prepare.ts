/** Préparation des ambiances (docs/SPEC.md §15, étape 6). Constantes ajustables. */
export const AMBIENCE_PREP = {
  /** Recouvrement fin → début qui rend la boucle sans couture. */
  crossfadeSeconds: 3,
  loudnessLufs: -28,
  /** Le fichier web est décodé en entier par le lecteur : 2 à 4 min au plus. */
  webSeconds: 180,
  /** Le fichier maître, bouclé par FFmpeg, peut être plus long. */
  masterSeconds: 600,
  sampleRate: 48_000,
} as const;

/**
 * Boucle sans couture : la piste commence après les `X` premières secondes, et sa fin
 * se fond dans ces `X` secondes mises de côté. Quand la boucle redémarre, elle enchaîne
 * donc exactement là où le fondu s'est arrêté.
 */
export function seamlessLoopFilter(): string {
  const x = AMBIENCE_PREP.crossfadeSeconds;
  return `[0:a][1:a]acrossfade=d=${x}:c1=qsin:c2=qsin,loudnorm=I=${AMBIENCE_PREP.loudnessLufs}:TP=-3:LRA=11,aresample=${AMBIENCE_PREP.sampleRate}[out]`;
}

export function ambiencePrepareArgs(
  input: string,
  output: string,
  opts: { sourceSeconds: number; target: "master" | "web" },
): string[] {
  const x = AMBIENCE_PREP.crossfadeSeconds;
  const limit = opts.target === "web" ? AMBIENCE_PREP.webSeconds : AMBIENCE_PREP.masterSeconds;
  const seconds = Math.min(opts.sourceSeconds, limit + x);
  return [
    // Le fichier est ouvert deux fois : le corps (après X), puis la tête (les X premières
    // secondes). Découper un même flux en deux avec `atrim` laisse `acrossfade` sans sortie.
    "-ss",
    String(x),
    "-t",
    (seconds - x).toFixed(3),
    "-i",
    input,
    "-t",
    String(x),
    "-i",
    input,
    "-filter_complex",
    seamlessLoopFilter(),
    "-map",
    "[out]",
    "-ac",
    "2",
    ...(opts.target === "master"
      ? ["-c:a", "flac"]
      : ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
    output,
  ];
}
