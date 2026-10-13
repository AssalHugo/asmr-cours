import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Réf. du projet : Project settings du tableau de bord Trigger.dev (docs/SETUP.md).
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_a_renseigner",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 5000,
      maxTimeoutInMs: 120_000,
      randomize: true,
    },
  },
  build: {
    // FFmpeg 7 statique : mêmes filtres (deesser, loudnorm, amix normalize) qu'en local.
    // L'extension pose FFMPEG_PATH et FFPROBE_PATH, lus par src/lib/audio/ffmpeg.ts.
    extensions: [ffmpeg({ version: "7" })],
    // `server-only` se résout en module vide sous cette condition.
    conditions: ["react-server"],
  },
});
