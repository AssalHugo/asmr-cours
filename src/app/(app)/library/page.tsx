import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreathOrb } from "@/components/breath-orb";
import { CourseCard } from "@/components/course/course-card";
import { FolderActions, NewFolderButton } from "@/components/folder/folder-dialogs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import {
  listCourseFolders,
  listCourses,
  listFlaggedCourseIds,
  listFolders,
  listPlayback,
  listSharedWithMe,
} from "@/lib/data";

export const metadata: Metadata = { title: "Bibliothèque" };

/** Valeur de `?folder=` pour les cours rangés nulle part. */
const UNFILED = "none";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; folder?: string }>;
}) {
  const user = await requireUser();
  const { q, folder: folderParam } = await searchParams;
  const [allCourses, playback, flagged, shared, folders, placements] = await Promise.all([
    listCourses(q),
    listPlayback(),
    listFlaggedCourseIds(),
    listSharedWithMe(user.id),
    listFolders(),
    listCourseFolders(),
  ]);
  const searching = Boolean(q?.trim());

  // Un rangement vers un dossier disparu ou un cours devenu invisible ne compte pas.
  const folderIds = new Set(folders.map((f) => f.id));
  const folderOf = (courseId: string): string | null => {
    const id = placements.get(courseId);
    return id && folderIds.has(id) ? id : null;
  };
  const counts = new Map<string, number>();
  for (const course of allCourses) {
    const key = folderOf(course.id) ?? UNFILED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const current = folders.find((f) => f.id === folderParam) ?? null;
  const filter = current
    ? current.id
    : folderParam === UNFILED && folders.length > 0
      ? UNFILED
      : null;
  const courses =
    filter === null
      ? allCourses
      : allCourses.filter((course) => (folderOf(course.id) ?? UNFILED) === filter);

  const href = (folder: string | null) => {
    const params = new URLSearchParams();
    if (searching && q) params.set("q", q);
    if (folder) params.set("folder", folder);
    const query = params.toString();
    return query ? `/library?${query}` : "/library";
  };
  const chips = [
    { key: null, label: "Tous", count: allCourses.length },
    ...folders.map((f) => ({ key: f.id, label: f.name, count: counts.get(f.id) ?? 0 })),
    ...(folders.length > 0
      ? [{ key: UNFILED, label: "Sans dossier", count: counts.get(UNFILED) ?? 0 }]
      : []),
  ];

  return (
    <main>
      <PageHeader title="Bibliothèque" />

      {allCourses.length > 0 || searching ? (
        <form action="/library" role="search" className="relative mb-6">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
            aria-hidden
          />
          {filter ? <input type="hidden" name="folder" value={filter} /> : null}
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

      {allCourses.length > 0 || folders.length > 0 ? (
        <nav
          aria-label="Dossiers"
          className="-mx-4 mb-6 flex items-center gap-2 overflow-x-auto px-4 pb-1"
        >
          {chips.map((chip) => {
            const active = chip.key === filter;
            return (
              <Link
                key={chip.key ?? "all"}
                href={href(chip.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[0.95rem] transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="max-w-40 truncate">{chip.label}</span>
                <span className="tabular text-sm opacity-70">{chip.count}</span>
              </Link>
            );
          })}
          <NewFolderButton />
        </nav>
      ) : null}

      {current ? (
        <div className="mb-4">
          <FolderActions folder={current} />
        </div>
      ) : null}

      {courses.length === 0 ? (
        searching ? (
          <p className="text-muted-foreground py-12 text-center">
            Aucun cours ne porte ce titre{filter ? " dans ce dossier" : ""}.{" "}
            <Link href="/library" className="text-sand underline underline-offset-4">
              Tout afficher
            </Link>
          </p>
        ) : filter ? (
          <p className="text-muted-foreground py-12 text-center">
            {current
              ? "Ce dossier est vide. Range un cours ici depuis sa carte, dans la bibliothèque."
              : "Tous tes cours sont rangés dans un dossier."}{" "}
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
                sharedBy={
                  course.user_id === user.id ? null : (shared.get(course.id) ?? "un autre compte")
                }
                folders={folders}
                folderId={folderOf(course.id)}
                showFolder={filter === null}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
