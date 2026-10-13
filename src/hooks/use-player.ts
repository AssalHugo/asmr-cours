"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isIos, PlayerEngine, type PlayerSnapshot, type PlayerSources } from "@/lib/player/engine";
import { createClient } from "@/lib/supabase/browser";

const positionKey = (courseId: string) => `murmure-position-${courseId}`;

export type SavedPosition = { positionMs: number; updatedAt: number };

export function readLocalPosition(courseId: string): SavedPosition | null {
  try {
    const raw = localStorage.getItem(positionKey(courseId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "positionMs" in value &&
      typeof value.positionMs === "number" &&
      "updatedAt" in value &&
      typeof value.updatedAt === "number"
    ) {
      return { positionMs: value.positionMs, updatedAt: value.updatedAt };
    }
  } catch {
    // Stockage indisponible ou valeur illisible.
  }
  return null;
}

/** Position sauvegardée toutes les 10 s : sur l'appareil, et dans `playback_progress`. */
function persistPosition(courseId: string, userId: string, positionMs: number): void {
  const rounded = Math.round(positionMs);
  try {
    localStorage.setItem(
      positionKey(courseId),
      JSON.stringify({ positionMs: rounded, updatedAt: Date.now() }),
    );
  } catch {
    // Stockage plein ou désactivé.
  }
  if (!navigator.onLine) return;
  void createClient()
    .from("playback_progress")
    .upsert({
      user_id: userId,
      course_id: courseId,
      position_ms: rounded,
      updated_at: new Date().toISOString(),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

export type UsePlayer = { snapshot: PlayerSnapshot; engine: PlayerEngine | null };

const EMPTY: PlayerSnapshot = {
  phase: "idle",
  positionMs: 0,
  durationMs: 0,
  chapterIndex: 0,
  rate: 1,
  voiceLevel: 1,
  ambienceLevel: 0.6,
  ambienceId: "",
  ambienceReady: false,
  lockMode: false,
  sleep: { kind: "off" },
  sleepRemainingMs: null,
  error: null,
};

/** Relie le moteur du lecteur à React. Le moteur n'existe que côté navigateur. */
export function usePlayer(
  sources: PlayerSources,
  options: { userId: string; ambienceId: string; positionMs: number },
): UsePlayer {
  const [engine, setEngine] = useState<PlayerEngine | null>(null);
  const { userId, ambienceId, positionMs } = options;

  useEffect(() => {
    const instance = new PlayerEngine(sources, {
      lockMode: isIos(),
      ambienceId,
      positionMs,
      onPersist: (ms) => persistPosition(sources.courseId, userId, ms),
    });
    instance.mount();
    const frame = requestAnimationFrame(() => setEngine(instance));
    return () => {
      cancelAnimationFrame(frame);
      instance.destroy();
      setEngine(null);
    };
    // Le moteur vit le temps de la page : il n'est recréé que si le cours change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.courseId]);

  const store = useMemo(
    () => ({
      subscribe: engine ? engine.subscribe : () => () => undefined,
      get: engine ? engine.getSnapshot : () => EMPTY,
    }),
    [engine],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  return { snapshot, engine };
}
