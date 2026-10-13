import type { Metadata } from "next";
import { OfflineCourses } from "@/components/offline-courses";

export const metadata: Metadata = { title: "Hors-ligne" };

/** Page de repli quand le réseau manque : elle mène aux cours téléchargés sur l'appareil. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 p-6">
      <div className="space-y-3">
        <h1 className="text-4xl">Tu es hors-ligne</h1>
        <p className="text-muted-foreground">
          Les cours téléchargés sur cet appareil restent écoutables.
        </p>
      </div>
      <OfflineCourses />
    </main>
  );
}
