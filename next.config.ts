import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components et Partial Prefetching sont désactivés à dessein : chaque page dépend
  // de la session (cookies) et de données privées, il n'y a rien à prérendre. Activés, ils
  // exigent de valider un rendu « instantané » que le client Supabase (Date.now) empêche.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Binaires et modules natifs : laissés hors du bundle serveur.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "unpdf", "esbuild"],
};

export default withSerwist(nextConfig);
