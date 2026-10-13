import type { Database } from "@/lib/supabase/database.types";

export type CourseStatus = Database["public"]["Enums"]["course_status"];

export const STATUS_ORDER: readonly CourseStatus[] = [
  "queued",
  "extracting",
  "rewriting",
  "verifying",
  "synthesizing",
  "waiting_batch",
  "assembling",
  "mastering",
  "ready",
];

/** Avancement global (0 à 100) au début et à la fin de chaque étape. */
export const STATUS_RANGE: Record<CourseStatus, readonly [number, number]> = {
  queued: [0, 2],
  extracting: [2, 12],
  rewriting: [12, 30],
  verifying: [30, 38],
  synthesizing: [38, 85],
  waiting_batch: [38, 85],
  assembling: [85, 92],
  mastering: [92, 99],
  ready: [100, 100],
  failed: [0, 0],
};

export const STATUS_LABEL: Record<CourseStatus, string> = {
  queued: "En file d'attente",
  extracting: "Lecture du cours",
  rewriting: "Écriture du script",
  verifying: "Contrôle de fidélité",
  synthesizing: "Enregistrement de la voix",
  waiting_batch: "Voix en préparation (mode Éco)",
  assembling: "Assemblage",
  mastering: "Mixage",
  ready: "Prêt à écouter",
  failed: "Interrompu",
};

/** Avancement global pour une étape achevée à `fraction` (0 à 1). */
export function progressFor(status: CourseStatus, fraction = 0): number {
  const [start, end] = STATUS_RANGE[status];
  return Math.round(start + (end - start) * Math.min(1, Math.max(0, fraction)));
}

export const isActive = (status: CourseStatus) => status !== "ready" && status !== "failed";

/** État publié à chaque étape : metadata du run Trigger.dev et ligne `courses`. */
export type RunProgress = {
  status: CourseStatus;
  progress: number;
  costUsd: number;
  durationMs: number;
  error?: string;
};
