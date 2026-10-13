"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { cacheAvailable, clearOffline, listOfflineCourseIds, storageEstimate } from "@/lib/offline";

type Info = { courses: number; usedBytes: number; quotaBytes: number; persisted: boolean };

/** Espace occupé par les cours téléchargés sur cet appareil, et sa suppression. */
export function OfflineStorage() {
  const [info, setInfo] = useState<Info | null>(null);

  const refresh = useCallback(async () => {
    if (!cacheAvailable()) return;
    const [ids, estimate] = await Promise.all([listOfflineCourseIds(), storageEstimate()]);
    setInfo({ courses: ids.length, ...estimate });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!cacheAvailable()) return;
      const [ids, estimate] = await Promise.all([listOfflineCourseIds(), storageEstimate()]);
      if (alive) setInfo({ courses: ids.length, ...estimate });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!info) return null;
  return (
    <div className="bg-card space-y-3 rounded-2xl p-4">
      <p>
        {info.courses === 0
          ? "Aucun cours téléchargé sur cet appareil."
          : `${info.courses} cours téléchargé${info.courses > 1 ? "s" : ""} sur cet appareil.`}
      </p>
      <p className="text-muted-foreground tabular text-sm">
        {formatBytes(info.usedBytes)} utilisés
        {info.quotaBytes > 0 ? ` sur ${formatBytes(info.quotaBytes)} disponibles` : ""}.{" "}
        {info.persisted
          ? "Le navigateur s'engage à les conserver."
          : "Le navigateur peut les effacer s'il manque de place."}
      </p>
      {info.courses > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void clearOffline().then(() => {
              toast("Cours retirés de cet appareil.");
              return refresh();
            })
          }
        >
          Tout retirer de l&apos;appareil
        </Button>
      ) : null}
    </div>
  );
}
