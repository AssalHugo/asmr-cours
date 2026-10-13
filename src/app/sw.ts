/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RouteHandlerCallbackOptions, SerwistGlobalConfig } from "serwist";
import { createPartialResponse, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Même nom que dans src/lib/offline.ts : la page y range les cours téléchargés.
const AUDIO_CACHE = "murmure-audio-v1";
const PLAYER_PAGE = /^\/play\/[0-9a-f-]{36}$/;

/**
 * Fichiers de cours. La clé de cache est l'adresse stable (/api/audio/…), jamais l'URL
 * présignée. Le cache contient des réponses complètes (200) ; une requête `Range`, que
 * tout lecteur audio émet, reçoit la plage demandée (206) découpée dans cette réponse.
 */
async function audioHandler({ request }: RouteHandlerCallbackOptions): Promise<Response> {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(new URL(request.url).pathname);
  if (!cached) return fetch(request);
  return request.headers.has("range") ? createPartialResponse(request, cached) : cached;
}

/**
 * Page du lecteur d'un cours téléchargé : réseau d'abord (la copie est rafraîchie au
 * passage), copie locale si le réseau manque.
 */
async function playerPageHandler({ request }: RouteHandlerCallbackOptions): Promise<Response> {
  const cache = await caches.open(AUDIO_CACHE);
  const key = new URL(request.url).pathname;
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && (await cache.match(key))) {
      await cache.put(key, response.clone());
    }
    // Cours supprimé, ou partage retiré : sa copie hors-ligne part avec lui.
    if (response.status === 404) await purgeCourse(cache, key.slice("/play/".length));
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

async function purgeCourse(cache: Cache, courseId: string): Promise<void> {
  for (const cached of await cache.keys()) {
    const path = new URL(cached.url).pathname;
    if (path.startsWith(`/api/audio/${courseId}/`) || path === `/play/${courseId}`) {
      await cache.delete(cached);
    }
  }
}

/**
 * Après un déploiement, les pages de lecteur gardées hors-ligne pointent vers des scripts
 * de l'ancienne version : on les recharge dès que le nouveau service worker prend la main.
 */
async function refreshPlayerPages(): Promise<void> {
  const cache = await caches.open(AUDIO_CACHE);
  for (const cached of await cache.keys()) {
    const path = new URL(cached.url).pathname;
    if (!PLAYER_PAGE.test(path)) continue;
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (response.ok && !response.redirected) await cache.put(path, response);
      else if (response.status === 404) await purgeCourse(cache, path.slice("/play/".length));
    } catch {
      // Hors-ligne : la copie actuelle reste en place.
    }
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(refreshPlayerPages());
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/audio/"),
      handler: audioHandler,
    },
    {
      matcher: ({ url, sameOrigin, request }) =>
        sameOrigin && request.mode === "navigate" && PLAYER_PAGE.test(url.pathname),
      handler: playerPageHandler,
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
