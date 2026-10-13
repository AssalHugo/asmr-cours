"use client";

import { useRealtimeRun } from "@trigger.dev/react-hooks";
import { useEffect, useState } from "react";
import type { RealtimeAccess } from "@/app/api/realtime-token/route";
import { isActive, type CourseStatus, type RunProgress } from "@/lib/pipeline/status";
import { createClient } from "@/lib/supabase/browser";

const POLL_MS = 2000;
const STATUSES = new Set<string>([
  "queued",
  "extracting",
  "rewriting",
  "verifying",
  "synthesizing",
  "waiting_batch",
  "assembling",
  "mastering",
  "ready",
  "failed",
]);

export type CourseRun = RunProgress & { live: boolean };

/**
 * Suit la génération d'un cours. Avec Trigger.dev : temps réel sur la metadata du run,
 * via un jeton public limité à ce run. La ligne `courses` est relue en parallèle : c'est
 * la seule source en mode inline, et le filet de sécurité si le temps réel décroche.
 */
export function useCourseRun(courseId: string, initial: RunProgress): CourseRun {
  const [progress, setProgress] = useState(initial);
  const [access, setAccess] = useState<RealtimeAccess>({ mode: "poll" });
  const active = isActive(progress.status);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void fetch(`/api/realtime-token?courseId=${courseId}`)
      .then((res) => (res.ok ? (res.json() as Promise<RealtimeAccess>) : { mode: "poll" as const }))
      .then((value) => alive && setAccess(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, active]);

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    let alive = true;
    const tick = async () => {
      const { data } = await supabase
        .from("courses")
        .select("status, progress, actual_cost_usd, duration_ms, error")
        .eq("id", courseId)
        .maybeSingle();
      if (!data || !alive) return;
      setProgress((previous) => ({
        status: data.status,
        progress:
          data.status === "ready"
            ? 100
            : Math.max(
                data.progress,
                isActive(data.status) && data.status === previous.status ? previous.progress : 0,
              ),
        costUsd: Math.max(Number(data.actual_cost_usd), previous.costUsd),
        durationMs: data.duration_ms ?? previous.durationMs,
        error: data.error ?? undefined,
      }));
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [courseId, active]);

  const realtime = access.mode === "trigger";
  const { run } = useRealtimeRun(realtime ? access.runId : undefined, {
    accessToken: realtime ? access.token : undefined,
    enabled: realtime && active,
  });
  // La metadata du run devance la base de quelques instants : elle prime tant que le run vit.
  const meta = active ? run?.metadata : undefined;
  const status = meta?.status;
  if (!meta || typeof status !== "string" || !STATUSES.has(status)) {
    return { ...progress, live: realtime };
  }
  return {
    status: status as CourseStatus,
    progress:
      typeof meta.progress === "number"
        ? Math.max(meta.progress, progress.progress)
        : progress.progress,
    costUsd: typeof meta.costUsd === "number" ? meta.costUsd : progress.costUsd,
    durationMs: typeof meta.durationMs === "number" ? meta.durationMs : progress.durationMs,
    error: typeof meta.error === "string" ? meta.error : progress.error,
    live: true,
  };
}
