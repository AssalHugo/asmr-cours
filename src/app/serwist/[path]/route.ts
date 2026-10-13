import { createSerwistRoute } from "@serwist/turbopack";

/** Sert le service worker compilé (/serwist/sw.js), avec la liste des fichiers à précacher. */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    additionalPrecacheEntries: [
      { url: "/~offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()) },
    ],
    useNativeEsbuild: true,
  },
);
