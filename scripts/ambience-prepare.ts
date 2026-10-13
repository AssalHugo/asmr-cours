/**
 * Prépare les ambiances déposées dans assets/ambience/raw/ (fichiers CC0 nommés d'après
 * leur identifiant : rain.wav, library.flac, fireplace.mp3, lofi.ogg…).
 * Pour chacune : boucle sans couture (crossfade fin → début), normalisation à −28 LUFS,
 * puis deux sorties dans assets/ambience/out/ : FLAC (mix serveur) et AAC (lecteur).
 * Usage : pnpm ambience:prepare
 */
import { mkdir, readdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { AMBIENCES, getAmbience, SYNTHETIC_AMBIENCE_ID } from "@/lib/ambiences";
import { AMBIENCE_PREP, ambiencePrepareArgs } from "@/lib/audio/ambience-prepare";
import { probeDurationMs, runFfmpeg } from "@/lib/audio/ffmpeg";

const RAW = "assets/ambience/raw";
const OUT = "assets/ambience/out";

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(RAW)).filter((name) => !name.startsWith("."));
  if (files.length === 0) {
    console.log(
      `Aucun fichier dans ${RAW}. Identifiants attendus : ${AMBIENCES.map((a) => a.id).join(", ")}.`,
    );
    console.log(
      `(« ${SYNTHETIC_AMBIENCE_ID} » n'a besoin d'aucun fichier : il est synthétisé par FFmpeg.)`,
    );
    return;
  }
  for (const name of files) {
    const id = parse(name).name;
    if (!getAmbience(id)) {
      console.warn(
        `· ${name} ignoré : « ${id} » n'est pas une ambiance connue (src/lib/ambiences.ts).`,
      );
      continue;
    }
    const input = join(RAW, name);
    const sourceSeconds = (await probeDurationMs(input)) / 1000;
    if (sourceSeconds < AMBIENCE_PREP.crossfadeSeconds * 4) {
      console.warn(`· ${name} ignoré : trop court (${sourceSeconds.toFixed(1)} s).`);
      continue;
    }
    await runFfmpeg(
      ambiencePrepareArgs(input, join(OUT, `${id}.flac`), { sourceSeconds, target: "master" }),
    );
    await runFfmpeg(
      ambiencePrepareArgs(input, join(OUT, `${id}.m4a`), { sourceSeconds, target: "web" }),
    );
    console.log(`✓ ${id} : ${OUT}/${id}.flac et ${OUT}/${id}.m4a`);
  }
  console.log("Écoute les fichiers, puis lance : pnpm ambience:upload");
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
