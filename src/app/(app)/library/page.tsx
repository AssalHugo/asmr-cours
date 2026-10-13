import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreathOrb } from "@/components/breath-orb";
import { CourseCard } from "@/components/course/course-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listCourses, listFlaggedCourseIds, listPlayback } from "@/lib/data";

export const metadata: Metadata = { title: "Bibliothèque" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [courses, playback, flagged] = await Promise.all([
    listCourses(q),
    listPlayback(),
    listFlaggedCourseIds(),
  ]);
  const searching = Boolean(q?.trim());

  return (
    <main>
      <PageHeader title="Bibliothèque" />

      {courses.length > 0 || searching ? (
        <form action="/library" role="search" className="relative mb-6">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Chercher un cours"
            aria-label="Chercher un cours par son titre"
            className="bg-card placeholder:text-muted-foreground h-12 w-full rounded-full pr-4 pl-12"
          />
        </form>
      ) : null}

      {courses.length === 0 ? (
        searching ? (
          <p className="text-muted-foreground py-12 text-center">
            Aucun cours ne porte ce titre.{" "}
            <Link href="/library" className="text-sand underline underline-offset-4">
              Tout afficher
            </Link>
          </p>
        ) : (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <BreathOrb size="md" />
            <div className="space-y-2">
              <h2 className="text-2xl">Rien à écouter pour l&apos;instant</h2>
              <p className="text-muted-foreground mx-auto max-w-xs">
                Dépose un PDF, des photos de tes notes ou un texte. Murmure te le lit tout bas.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/new">
                <Plus aria-hidden />
                Créer un cours
              </Link>
            </Button>
          </div>
        )
      ) : (
        <ul className="space-y-4">
          {courses.map((course) => (
            <li key={course.id}>
              <CourseCard
                course={course}
                positionMs={playback.get(course.id) ?? 0}
                flagged={flagged.has(course.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
