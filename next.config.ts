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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  // Binaires et modules natifs : laissés hors du bundle serveur.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "unpdf", "esbuild"],
};

export default withSerwist(nextConfig);
