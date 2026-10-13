/** Machine d'état du lecteur (docs/SPEC.md §10). Fonction pure. */

export type PlayerPhase = "idle" | "loading" | "playing" | "paused" | "ended";

export type PlayerEvent =
  | { type: "LOAD" }
  | { type: "READY" }
  | { type: "PLAY" }
  | { type: "PLAYING" }
  | { type: "PAUSE" }
  | { type: "WAITING" }
  | { type: "ENDED" }
  | { type: "SEEK" }
  | { type: "INTERRUPTED" }
  | { type: "ERROR" };

/**
 * `wantsPlay` retient l'intention pendant un chargement : une lecture demandée avant
 * que le média soit prêt démarre dès qu'il l'est, et un tampon vide ne la fait pas oublier.
 */
export type PlayerState = { phase: PlayerPhase; wantsPlay: boolean };

export const initialPlayerState: PlayerState = { phase: "idle", wantsPlay: false };

export function playerReducer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case "LOAD":
      return { phase: "loading", wantsPlay: false };
    case "READY":
      if (state.phase !== "loading") return state;
      return state.wantsPlay ? state : { phase: "paused", wantsPlay: false };
    case "PLAY":
      if (state.phase === "idle") return state;
      if (state.phase === "playing") return state;
      return { phase: "loading", wantsPlay: true };
    case "PLAYING":
      return state.wantsPlay ? { phase: "playing", wantsPlay: true } : state;
    case "WAITING":
      return state.phase === "playing" ? { phase: "loading", wantsPlay: true } : state;
    case "PAUSE":
    case "INTERRUPTED":
      if (state.phase === "idle" || state.phase === "ended") return state;
      return { phase: "paused", wantsPlay: false };
    case "ENDED":
      return state.phase === "idle" ? state : { phase: "ended", wantsPlay: false };
    case "SEEK":
      // Revenir en arrière depuis la fin remet le lecteur en pause, prêt à repartir.
      return state.phase === "ended" ? { phase: "paused", wantsPlay: false } : state;
    case "ERROR":
      return { phase: "idle", wantsPlay: false };
  }
}
