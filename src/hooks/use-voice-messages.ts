"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { markVoiceMessagePlayed } from "@/app/(app)/actions";
import type { PlayerEngine, PlayerSnapshot } from "@/lib/player/engine";
import { dueMessage, type PendingMessage } from "@/lib/voice-messages";

export type VoiceMessageState =
  | { kind: "none" }
  /** Un message attend un geste : au lancement, ou lecture automatique refusée (iOS). */
  | { kind: "waiting"; message: PendingMessage }
  | { kind: "playing"; message: PendingMessage };

/**
 * Messages vocaux d'un cours : chacun est joué une fois, cours en pause, au lancement ou quand
 * la lecture atteint son moment. Puis marqué entendu et la lecture reprend.
 */
export function useVoiceMessages(
  engine: PlayerEngine | null,
  snapshot: PlayerSnapshot,
  initial: readonly PendingMessage[],
) {
  const [pending, setPending] = useState<PendingMessage[]>(() => [...initial]);
  const [state, setState] = useState<VoiceMessageState>(() => {
    const launch = initial.find((m) => m.atMs === null);
    return launch ? { kind: "waiting", message: launch } : { kind: "none" };
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resumeRef = useRef(false);
  const unlockedRef = useRef(false);
  /** Messages dont la lecture automatique a été refusée : ils attendent un toucher. */
  const refusedRef = useRef(new Set<string>());

  const audio = useCallback(() => {
    audioRef.current ??= new Audio();
    return audioRef.current;
  }, []);

  // iOS n'autorise `play()` hors geste que sur un élément déjà lancé par un geste :
  // au premier toucher, on le lance muet puis on l'arrête.
  useEffect(() => {
    if (initial.length === 0) return;
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      const el = audio();
      el.muted = true;
      el.src = `/api/messages/${initial[0]?.id ?? ""}`;
      el.play().then(
        () => {
          // Le même toucher a pu lancer un message pour de vrai : on ne coupe que l'essai muet.
          if (!el.muted) return;
          el.pause();
          el.muted = false;
        },
        () => undefined,
      );
    };
    document.addEventListener("pointerdown", unlock, { capture: true, once: true });
    return () => document.removeEventListener("pointerdown", unlock, { capture: true });
  }, [initial, audio]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const finish = useCallback(
    (message: PendingMessage) => {
      void markVoiceMessagePlayed(message.id);
      setPending((list) => list.filter((m) => m.id !== message.id));
      setState({ kind: "none" });
      if (resumeRef.current) {
        resumeRef.current = false;
        void engine?.play();
      }
    },
    [engine],
  );

  const start = useCallback(
    (message: PendingMessage, fromGesture: boolean) => {
      const wasPlaying = engine?.getSnapshot().phase === "playing";
      if (wasPlaying) engine?.pause();
      resumeRef.current = wasPlaying || resumeRef.current;
      const el = audio();
      el.muted = false;
      el.src = `/api/messages/${message.id}`;
      el.onended = () => finish(message);
      el.onerror = () => finish(message);
      setState({ kind: "playing", message });
      el.play().catch(() => {
        if (fromGesture) return finish(message);
        // Lecture automatique refusée : le cours continue, le message attend un toucher.
        refusedRef.current.add(message.id);
        setState({ kind: "waiting", message });
        if (resumeRef.current) {
          resumeRef.current = false;
          void engine?.play();
        }
      });
    },
    [engine, audio, finish],
  );

  // Pendant la lecture : le premier message dû se joue.
  const { phase, positionMs } = snapshot;
  useEffect(() => {
    if (!engine || phase !== "playing" || state.kind !== "none") return;
    const due = dueMessage(pending, positionMs);
    if (!due) return;
    const frame = requestAnimationFrame(() => start(due, false));
    return () => cancelAnimationFrame(frame);
  }, [engine, phase, positionMs, pending, state.kind, start]);

  // Un message au lancement passe avant le cours, même si elle appuie directement sur lecture.
  useEffect(() => {
    if (!engine || phase !== "playing" || state.kind !== "waiting") return;
    // Déjà refusé : sans ce garde-fou, le cours relancé redéclencherait l'essai en boucle.
    if (state.message.atMs !== null || refusedRef.current.has(state.message.id)) return;
    const frame = requestAnimationFrame(() => start(state.message, false));
    return () => cancelAnimationFrame(frame);
  }, [engine, phase, state, start]);

  return {
    state,
    listen: () => (state.kind === "waiting" ? start(state.message, true) : undefined),
    skip: () => {
      if (state.kind === "none") return;
      audioRef.current?.pause();
      finish(state.message);
    },
  };
}
