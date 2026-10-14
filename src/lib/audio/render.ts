import { runFfmpeg, runFfmpegVerbose } from "./ffmpeg";
import { masterArgs, measureLoudnessArgs, parseLoudness } from "./master";
import { parseVolume, trimSilenceArgs, type ChunkLevel } from "./silence";

/** Rogne et adoucit les bords d'un chunk ; renvoie son niveau, pour l'égalisation entre chunks. */
export async function trimChunk(input: string, output: string): Promise<ChunkLevel | null> {
  const { stderr } = await runFfmpegVerbose(trimSilenceArgs(input, output));
  return parseVolume(stderr);
}

/** Mastering en deux passes : mesure de la sonie, puis gain fixe. */
export async function masterVoice(input: string, output: string): Promise<void> {
  const { stderr } = await runFfmpegVerbose(measureLoudnessArgs(input));
  await runFfmpeg(masterArgs(input, output, parseLoudness(stderr) ?? undefined));
}
