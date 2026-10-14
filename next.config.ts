import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const origin = (value: string | undefined): string | null => {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
};

/**
 * Politique de contenu. Les scripts en ligne restent permis (Next en injecte pour
 * l'hydratation, et le thème est posé avant le premier rendu) ; le reste est fermé :
 * pas de cadre, pas de plugin, et le réseau limité à Supabase, R2 et Trigger.dev.
 * Les origines Google ne s'ouvrent que si l'import Drive est configuré.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  // Le SDK S3 signe en « virtual-hosted » : le bucket préfixe l'hôte du compte.
  const r2 = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_BUCKET || "murmure-audio"}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "https://*.r2.cloudflarestorage.com";
  const trigger = origin(process.env.TRIGGER_API_URL) ?? "https://api.trigger.dev";
  const drive = Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
  );
  const connect = [
    "'self'",
    supabase,
    supabase?.replace(/^http/, "ws"),
    r2,
    trigger,
    dev ? "ws:" : null,
    ...(drive
      ? [
          "https://www.googleapis.com",
          "https://*.googleusercontent.com",
          "https://accounts.google.com",
        ]
      : []),
  ].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${drive ? " https://apis.google.com https://accounts.google.com" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `media-src 'self' data: blob: ${r2}`,
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self'",
    // Le sélecteur Drive et GIS s'affichent dans des cadres servis par Google.
    drive
      ? "frame-src https://docs.google.com https://drive.google.com https://accounts.google.com"
      : "frame-src 'none'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

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
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          // Ignoré en HTTP (développement local) ; en production, le site ne se sert qu'en HTTPS.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
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
