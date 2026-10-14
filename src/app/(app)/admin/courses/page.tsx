import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { MODE_LABEL, TIER_LABEL } from "@/components/admin/labels";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ADMIN_PAGE_SIZE, listAccounts, listAllCourses } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatDuration, formatUsd } from "@/lib/format";
import { isActive, STATUS_LABEL, STATUS_ORDER } from "@/lib/pipeline/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin · cours" };

const STATUSES = [...STATUS_ORDER, "failed"] as const;

const Filters = z.object({
  user: z.uuid().optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters = Filters.parse({
    user: first(raw.user),
    status: first(raw.status),
    q: first(raw.q),
    page: first(raw.page),
  });
  const [accounts, { courses, total }] = await Promise.all([
    listAccounts(),
    listAllCourses(
      { userId: filters.user, status: filters.status, search: filters.q },
      filters.page,
    ),
  ]);
  const emailOf = new Map(accounts.map((a) => [a.id, a.displayName ?? a.email]));
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.user) params.set("user", filters.user);
    if (filters.status) params.set("status", filters.status);
    if (filters.q) params.set("q", filters.q);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/admin/courses?${qs}` : "/admin/courses";
  };
  const filtered = Boolean(filters.user || filters.status || filters.q);

  return (
    <main>
      <PageHeader title="Tous les cours" back={{ href: "/admin", label: "Admin" }} />
      <AdminTabs current="/admin/courses" />

      <form action="/admin/courses" className="mb-6 space-y-3" role="search">
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Chercher un titre"
          aria-label="Chercher un cours par son titre"
          className="bg-card placeholder:text-muted-foreground h-12 w-full rounded-full px-5"
        />
        <div className="flex gap-2">
          <select
            name="user"
            defaultValue={filters.user ?? ""}
            aria-label="Compte"
            className="bg-card h-12 min-w-0 flex-1 rounded-full px-4"
          >
            <option value="">Tous les comptes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName ?? a.email}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label="État"
            className="bg-card h-12 min-w-0 flex-1 rounded-full px-4"
          >
            <option value="">Tous les états</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {total} cours
            {filtered ? (
              <>
                {" · "}
                <Link href="/admin/courses" className="text-sand underline underline-offset-4">
                  Tout afficher
                </Link>
              </>
            ) : null}
          </p>
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </div>
      </form>

      {courses.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">Aucun cours.</p>
      ) : (
        <ul className="space-y-3">
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/courses/${c.id}`}
                className="bg-card hover:bg-accent block space-y-2 rounded-3xl p-5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg leading-snug">{c.title}</h2>
                  <p className="tabular shrink-0">{formatUsd(c.realUsd, 3)}</p>
                </div>
                <p className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
                  <span>{emailOf.get(c.user_id) ?? "compte supprimé"}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDate(c.created_at)}</span>
                  {c.duration_ms ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{formatDuration(c.duration_ms)}</span>
                    </>
                  ) : null}
                </p>
                <p className="flex flex-wrap gap-x-2 text-sm">
                  <span
                    className={cn(
                      c.status === "failed"
                        ? "text-destructive"
                        : c.status === "ready"
                          ? "text-sand"
                          : "text-lavender",
                    )}
                  >
                    {STATUS_LABEL[c.status]}
                    {isActive(c.status) ? ` · ${c.progress} %` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    · {MODE_LABEL[c.mode]} · {TIER_LABEL[c.tier]}
                    {c.est_cost_usd !== null
                      ? ` · estimé ${formatUsd(Number(c.est_cost_usd), 3)}`
                      : ""}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-8 flex items-center justify-between gap-3">
          {filters.page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={pageHref(filters.page - 1)}>Précédents</Link>
            </Button>
          ) : (
            <span />
          )}
          <p className="text-muted-foreground tabular text-sm">
            {filters.page} / {pages}
          </p>
          {filters.page < pages ? (
            <Button asChild variant="secondary">
              <Link href={pageHref(filters.page + 1)}>Suivants</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
