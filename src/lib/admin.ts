import "server-only";
import type { Course, Section } from "@/lib/data";
import type { CourseStatus } from "@/lib/pipeline/status";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lectures du mode admin : clé secrète, tous comptes confondus. Réservées aux pages qui
 * appellent `requireAdmin()` d'abord. Les sommes sont faites en SQL (`admin_*`, `course_costs`).
 */

const COURSE_COLUMNS =
  "id, user_id, title, source_kind, source_chars, mode, tier, quality, voice_id, ambience, ambience_gain_db, address_form, status, progress, error, est_cost_usd, actual_cost_usd, duration_ms, created_at, updated_at" as const;

/** Taille d'une page de la liste des cours (les identifiants passent dans l'URL de `course_costs`). */
export const ADMIN_PAGE_SIZE = 50;

export type Account = {
  id: string;
  email: string;
  displayName: string | null;
  budgetUsd: number | null;
  createdAt: string;
  lastSignInAt: string | null;
};

export type SpendBreakdownRow = {
  step: string;
  model: string;
  tier: string;
  costUsd: number;
  events: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  audioSeconds: number;
};

export type AccountSummary = Account & {
  monthUsd: number;
  totalUsd: number;
  courses: number;
  ready: number;
  failed: number;
  durationMs: number;
};

export type AdminOverview = {
  totalUsd: number;
  monthUsd: number;
  months: { month: string; costUsd: number }[];
  accounts: AccountSummary[];
  breakdown: SpendBreakdownRow[];
  statusCounts: Partial<Record<CourseStatus, number>>;
  totalCourses: number;
  totalDurationMs: number;
};

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what} illisible : ${error?.message ?? "réponse vide"}`);
}

export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Comptes Supabase (adresse, dernière connexion) et leur profil. */
export async function listAccounts(): Promise<Account[]> {
  const admin = createAdminClient();
  const accounts: Account[] = [];
  const profiles = await admin.from("profiles").select("id, display_name, monthly_budget_usd");
  if (profiles.error) fail("Profils", profiles.error);
  const byId = new Map(profiles.data.map((p) => [p.id, p]));
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail("Comptes", error);
    for (const u of data.users) {
      const profile = byId.get(u.id);
      accounts.push({
        id: u.id,
        email: u.email ?? "(sans adresse)",
        displayName: profile?.display_name ?? null,
        budgetUsd: profile ? Number(profile.monthly_budget_usd) : null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < 200) return accounts;
  }
}

export async function getSpendBreakdown(
  filter: { since?: string; courseId?: string } = {},
): Promise<SpendBreakdownRow[]> {
  const { data, error } = await createAdminClient().rpc("admin_spend_breakdown", {
    ...(filter.since ? { p_since: filter.since } : {}),
    ...(filter.courseId ? { p_course_id: filter.courseId } : {}),
  });
  if (error) fail("Détail des dépenses", error);
  return data.map((r) => ({
    step: r.step,
    model: r.model,
    tier: r.tier,
    costUsd: Number(r.cost_usd),
    events: Number(r.events),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    thinkingTokens: Number(r.thinking_tokens),
    audioSeconds: Number(r.audio_seconds),
  }));
}

export async function getAdminOverview(now = new Date()): Promise<AdminOverview> {
  const admin = createAdminClient();
  const since = monthStart(now);
  const [total, month, months, spendAll, spendMonth, counts, breakdown, accounts] =
    await Promise.all([
      admin.rpc("spend_since", { p_since: new Date(0).toISOString() }),
      admin.rpc("spend_since", { p_since: since }),
      admin.rpc("admin_spend_by_month", { p_months: 12 }),
      admin.rpc("admin_spend_by_user", { p_since: new Date(0).toISOString() }),
      admin.rpc("admin_spend_by_user", { p_since: since }),
      admin.rpc("admin_course_counts"),
      getSpendBreakdown(),
      listAccounts(),
    ]);
  if (total.error) fail("Dépense totale", total.error);
  if (month.error) fail("Dépense du mois", month.error);
  if (months.error) fail("Dépense par mois", months.error);
  if (spendAll.error) fail("Dépense par compte", spendAll.error);
  if (spendMonth.error) fail("Dépense du mois par compte", spendMonth.error);
  if (counts.error) fail("Nombre de cours", counts.error);

  const totalBy = new Map(spendAll.data.map((r) => [r.user_id, Number(r.cost_usd)]));
  const monthBy = new Map(spendMonth.data.map((r) => [r.user_id, Number(r.cost_usd)]));
  const statusCounts: Partial<Record<CourseStatus, number>> = {};
  const perUser = new Map<string, { courses: number; ready: number; failed: number; ms: number }>();
  let totalCourses = 0;
  let totalDurationMs = 0;
  for (const row of counts.data) {
    const n = Number(row.courses);
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + n;
    totalCourses += n;
    const entry = perUser.get(row.user_id) ?? { courses: 0, ready: 0, failed: 0, ms: 0 };
    entry.courses += n;
    if (row.status === "ready") {
      entry.ready += n;
      entry.ms += Number(row.duration_ms);
      totalDurationMs += Number(row.duration_ms);
    }
    if (row.status === "failed") entry.failed += n;
    perUser.set(row.user_id, entry);
  }

  return {
    totalUsd: Number(total.data),
    monthUsd: Number(month.data),
    months: fillMonths(
      months.data.map((m) => ({ month: m.month, costUsd: Number(m.cost_usd) })),
      12,
      now,
    ),
    accounts: accounts
      .map((a) => {
        const c = perUser.get(a.id);
        return {
          ...a,
          monthUsd: monthBy.get(a.id) ?? 0,
          totalUsd: totalBy.get(a.id) ?? 0,
          courses: c?.courses ?? 0,
          ready: c?.ready ?? 0,
          failed: c?.failed ?? 0,
          durationMs: c?.ms ?? 0,
        };
      })
      .sort((x, y) => y.totalUsd - x.totalUsd || y.courses - x.courses),
    breakdown,
    statusCounts,
    totalCourses,
    totalDurationMs,
  };
}

/** Complète les mois sans dépense, du plus ancien au mois en cours (clé `AAAA-MM-01`). */
export function fillMonths(
  rows: { month: string; costUsd: number }[],
  count: number,
  now = new Date(),
): { month: string; costUsd: number }[] {
  const byMonth = new Map(rows.map((r) => [r.month.slice(0, 7), r.costUsd]));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1));
    const key = d.toISOString().slice(0, 7);
    return { month: `${key}-01`, costUsd: byMonth.get(key) ?? 0 };
  });
}

export type AdminCourse = Course & { realUsd: number };

export type AdminCourseFilter = { userId?: string; status?: CourseStatus; search?: string };

/** Cours de tous les comptes, du plus récent au plus ancien, avec leur coût réel. */
export async function listAllCourses(
  filter: AdminCourseFilter,
  page: number,
): Promise<{ courses: AdminCourse[]; total: number }> {
  const admin = createAdminClient();
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  let query = admin
    .from("courses")
    .select(COURSE_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + ADMIN_PAGE_SIZE - 1);
  if (filter.userId) query = query.eq("user_id", filter.userId);
  if (filter.status) query = query.eq("status", filter.status);
  const term = filter.search?.trim();
  if (term) query = query.ilike("title", `%${term.replace(/[%_\\]/g, "\\$&")}%`);
  const { data, error, count } = await query;
  if (error) fail("Cours", error);
  const costs = await courseCosts(data.map((c) => c.id));
  return {
    courses: data.map((c) => ({ ...c, realUsd: costs.get(c.id) ?? 0 })),
    total: count ?? data.length,
  };
}

async function courseCosts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await createAdminClient()
    .from("course_costs")
    .select("course_id, cost_usd")
    .in("course_id", ids);
  if (error) fail("Coût des cours", error);
  const out = new Map<string, number>();
  for (const c of data) if (c.course_id) out.set(c.course_id, Number(c.cost_usd ?? 0));
  return out;
}

export type AdminCourseDetail = {
  course: AdminCourse;
  sections: Section[];
  breakdown: SpendBreakdownRow[];
  voiceLabel: string | null;
  ownerEmail: string | null;
};

export async function getAdminCourse(courseId: string): Promise<AdminCourseDetail | null> {
  const admin = createAdminClient();
  const { data: course, error } = await admin
    .from("courses")
    .select(COURSE_COLUMNS)
    .eq("id", courseId)
    .maybeSingle();
  if (error) fail("Cours", error);
  if (!course) return null;
  const [sections, breakdown, costs, voice, owner] = await Promise.all([
    admin.from("sections").select("*").eq("course_id", courseId).order("idx"),
    getSpendBreakdown({ courseId }),
    courseCosts([courseId]),
    course.voice_id
      ? admin.from("voices").select("label").eq("id", course.voice_id).maybeSingle()
      : null,
    admin.auth.admin.getUserById(course.user_id),
  ]);
  if (sections.error) fail("Sections", sections.error);
  return {
    course: { ...course, realUsd: costs.get(courseId) ?? 0 },
    sections: sections.data,
    breakdown,
    voiceLabel: voice?.data?.label ?? null,
    ownerEmail: owner.data.user?.email ?? null,
  };
}

/** Le cours existe-t-il ? Pour ouvrir son audio depuis le mode admin. */
export async function courseExists(courseId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  return data !== null;
}
