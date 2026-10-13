/** Cache hors-ligne des cours (Cache Storage), partagé entre la page et le service worker. */

export const AUDIO_CACHE = "murmure-audio-v1";

/** Adresses stables d'un cours : la clé de cache ne dépend d'aucune signature présignée. */
export function courseFiles(courseId: string, ambience: string): string[] {
  return [
    `/api/audio/${courseId}/voice.m4a`,
    `/api/audio/${courseId}/mix-${ambience}.m4a`,
    `/api/audio/${courseId}/chapters.json`,
    `/api/audio/${courseId}/captions.json`,
    `/api/audio/ambience/${ambience}.m4a`,
  ];
}

export const coursePrefix = (courseId: string) => `/api/audio/${courseId}/`;

export function cacheAvailable(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/** Le cours est-il entièrement disponible hors-ligne ? */
export async function isCourseOffline(courseId: string): Promise<boolean> {
  if (!cacheAvailable()) return false;
  const cache = await caches.open(AUDIO_CACHE);
  return (await cache.match(`${coursePrefix(courseId)}voice.m4a`)) !== undefined;
}

/**
 * Télécharge les fichiers d'un cours dans Cache Storage. Les réponses stockées sont
 * complètes (200) ; le service worker en extrait les plages `Range` demandées.
 */
export async function downloadCourse(
  courseId: string,
  ambience: string,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const cache = await caches.open(AUDIO_CACHE);
  const files = courseFiles(courseId, ambience);
  let done = 0;
  onProgress(done, files.length);
  for (const url of files) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok || response.status !== 200) {
      await removeCourse(courseId);
      throw new Error(`Téléchargement interrompu (${response.status}).`);
    }
    await cache.put(url, response);
    onProgress(++done, files.length);
  }
  await navigator.storage?.persist?.().catch(() => false);
}

/** Retire un cours du cache. Les ambiances, partagées entre cours, restent. */
export async function removeCourse(courseId: string): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(AUDIO_CACHE);
  const prefix = coursePrefix(courseId);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith(prefix)) await cache.delete(request);
  }
}

export async function listOfflineCourseIds(): Promise<string[]> {
  if (!cacheAvailable()) return [];
  const cache = await caches.open(AUDIO_CACHE);
  const ids = new Set<string>();
  for (const request of await cache.keys()) {
    const match = /^\/api\/audio\/([0-9a-f-]{36})\/voice\.m4a$/.exec(new URL(request.url).pathname);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}

export async function clearOffline(): Promise<void> {
  if (cacheAvailable()) await caches.delete(AUDIO_CACHE);
}

export async function storageEstimate(): Promise<{
  usedBytes: number;
  quotaBytes: number;
  persisted: boolean;
}> {
  const estimate = (await navigator.storage?.estimate?.()) ?? {};
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0, persisted };
}
