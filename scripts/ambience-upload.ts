/**
 * Envoie les ambiances préparées (assets/ambience/out/) vers le stockage, et fabrique
 * le bruit rose, qui n'a pas de fichier source. Usage : pnpm ambience:upload
 */
import { readdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { getAmbience, SYNTHETIC_AMBIENCE_ID } from "@/lib/ambiences";
import { synthesizeAmbience } from "@/lib/audio/ambience-synth";
import { keys, storage } from "@/lib/storage";

const OUT = "assets/ambience/out";

async function main() {
  const store = storage();
  const files = await readdir(OUT).catch(() => [] as string[]);
  const sent = new Set<string>();
  for (const name of files) {
    const { name: id, ext } = parse(name);
    if (!getAmbience(id)) continue;
    if (ext === ".flac")
      await store.uploadFile(join(OUT, name), keys.ambienceMaster(id), "audio/flac");
    else if (ext === ".m4a")
      await store.uploadFile(join(OUT, name), keys.ambienceWeb(id), "audio/mp4");
    else continue;
    sent.add(id);
    console.log(`✓ ${name}`);
  }
  if (!sent.has(SYNTHETIC_AMBIENCE_ID)) {
    await synthesizeAmbience(store, SYNTHETIC_AMBIENCE_ID);
    console.log(`✓ ${SYNTHETIC_AMBIENCE_ID} (synthétisé)`);
  }
  console.log("Ambiances en place. Leur gain par défaut se règle dans src/lib/ambiences.ts.");
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
