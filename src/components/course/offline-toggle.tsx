"use client";

import { CloudDownload, CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cacheAvailable, downloadCourse, isCourseOffline, removeCourse } from "@/lib/offline";

/** « Télécharger » : garde la voix, le pré-mix, l'ambiance, les chapitres et les sous-titres sur l'appareil. */
export function OfflineToggle({
  courseId,
  ambience,
  title,
}: {
  courseId: string;
  ambience: string;
  title: string;
}) {
  const [state, setState] = useState<"unknown" | "online" | "offline" | "busy">("unknown");
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    void isCourseOffline(courseId).then((value) => alive && setState(value ? "offline" : "online"));
    return () => {
      alive = false;
    };
  }, [courseId]);

  if (state === "unknown" || !cacheAvailable()) return null;

  async function toggle() {
    if (state === "offline") {
      await removeCourse(courseId);
      setState("online");
      toast("Retiré de cet appareil.");
      return;
    }
    setState("busy");
    try {
      await downloadCourse(courseId, ambience, title, (n) => setDone(n));
      setState("offline");
      toast.success("Disponible hors-ligne.");
    } catch {
      setState("online");
      toast.error("Le téléchargement a échoué. Vérifie ta connexion.");
    }
  }

  return (
    <Button variant="secondary" size="sm" disabled={state === "busy"} onClick={() => void toggle()}>
      {state === "busy" ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : state === "offline" ? (
        <CloudOff aria-hidden />
      ) : (
        <CloudDownload aria-hidden />
      )}
      {state === "busy"
        ? `Téléchargement ${done}/6`
        : state === "offline"
          ? "Retirer de l'appareil"
          : "Télécharger"}
    </Button>
  );
}
