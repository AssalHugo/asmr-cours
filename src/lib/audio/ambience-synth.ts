import { join } from "node:path";
import { getAmbience } from "@/lib/ambiences";
import { withWorkdir } from "@/lib/pipeline/workdir";
import { keys } from "@/lib/storage/keys";
import type { ObjectStorage } from "@/lib/storage/types";
import { runFfmpeg } from "./ffmpeg";
import { noiseBedArgs } from "./mix";

/** Durée du lit d'ambiance synthétique, en secondes. */
export const SYNTH_AMBIENCE_SECONDS = 120;

/**
 * Fabrique le lit synthétique d'une ambiance (bruit coloré) et publie ses deux fichiers :
 * maître FLAC pour le mix serveur, AAC court pour le lecteur.
 */
export async function synthesizeAmbience(storage: ObjectStorage, id: string): Promise<void> {
  const ambience = getAmbience(id);
  if (!ambience) throw new Error(`Ambiance inconnue : ${id}`);
  await withWorkdir(async (dir) => {
    const master = join(dir, `${id}.flac`);
    const web = join(dir, `${id}.m4a`);
    const synth = { ...ambience.synth, seconds: SYNTH_AMBIENCE_SECONDS };
    await runFfmpeg(noiseBedArgs(master, { ...synth, codec: "flac" }));
    await runFfmpeg(noiseBedArgs(web, { ...synth, codec: "aac" }));
    await storage.uploadFile(master, keys.ambienceMaster(id), "audio/flac");
    await storage.uploadFile(web, keys.ambienceWeb(id), "audio/mp4");
  });
}
