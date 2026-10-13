"use client";

import { CloudDownload } from "lucide-react";
import { useEffect, useState } from "react";
import { isCourseOffline } from "@/lib/offline";

/** Badge « hors-ligne » : le cours est dans le cache de cet appareil. */
export function OfflineBadge({ courseId }: { courseId: string }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    void isCourseOffline(courseId).then((value) => alive && setOffline(value));
    return () => {
      alive = false;
    };
  }, [courseId]);
  if (!offline) return null;
  return (
    <span className="text-lavender inline-flex items-center gap-1">
      <span aria-hidden>·</span>
      <CloudDownload className="size-4" aria-hidden />
      Hors-ligne
    </span>
  );
}
