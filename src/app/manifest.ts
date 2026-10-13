import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Murmure",
    short_name: "Murmure",
    description: "Tes cours, chuchotés.",
    lang: "fr",
    start_url: "/library",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#14132b",
    theme_color: "#14132b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
