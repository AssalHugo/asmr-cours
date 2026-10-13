"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { listOfflineCourses, type OfflineCourse } from "@/lib/offline";

export function OfflineCourses() {
  const [courses, setCourses] = useState<OfflineCourse[] | null>(null);
  useEffect(() => {
    let alive = true;
    void listOfflineCourses().then((list) => alive && setCourses(list));
    return () => {
      alive = false;
    };
  }, []);

  if (!courses) return null;
  if (courses.length === 0) {
    return (
      <p className="bg-card rounded-2xl p-4">
        Aucun cours n&apos;est téléchargé. Une fois reconnectée, ouvre un cours et choisis «
        Télécharger ».
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {courses.map((course) => (
        <li key={course.id}>
          {/* Navigation complète : hors-ligne, la page vient du cache du service worker. */}
          <a
            href={`/play/${course.id}`}
            className="bg-card hover:bg-accent flex min-h-16 items-center gap-4 rounded-2xl p-4"
          >
            <Play className="text-sand size-6 shrink-0" fill="currentColor" aria-hidden />
            <span className="text-lg">{course.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
