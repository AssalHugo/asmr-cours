import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const isLocal = Boolean(url && /127\.0\.0\.1|localhost/.test(url) && publishableKey && secretKey);

type Client = SupabaseClient<Database>;

/** Ne tourne que contre le Supabase local (`pnpm db:start`), jamais contre un projet hébergé. */
describe.skipIf(!isLocal)("RLS (Supabase local)", () => {
  let admin: Client;
  const users: { id: string; email: string; client: Client }[] = [];
  let courseOfA = "";

  async function signUp(): Promise<{ id: string; email: string; client: Client }> {
    const email = `rls-${randomUUID()}@murmure.local`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw created.error;
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const client: Client = createClient<Database>(url ?? "", publishableKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await client.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "email",
    });
    if (verified.error) throw verified.error;
    return { id: created.data.user.id, email, client };
  }

  beforeAll(async () => {
    admin = createClient<Database>(url ?? "", secretKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    users.push(await signUp(), await signUp());
    const a = users[0]!;
    const course = await admin
      .from("courses")
      .insert({
        user_id: a.id,
        title: "Cours de A",
        source_kind: "text",
        mode: "whisper",
        tier: "eco",
        quality: "standard",
        ambience: "rain",
      })
      .select("id")
      .single();
    if (course.error) throw course.error;
    courseOfA = course.data.id;
    const section = await admin
      .from("sections")
      .insert({ course_id: courseOfA, idx: 0, title: "S1", source_text: "texte" })
      .select("id")
      .single();
    if (section.error) throw section.error;
    await admin.from("usage_events").insert({
      user_id: a.id,
      course_id: courseOfA,
      step: "rewrite",
      model: "mock",
      tier: "standard",
      cost_usd: 1.25,
    });
  });

  afterAll(async () => {
    if (admin) {
      for (const u of users) await admin.auth.admin.deleteUser(u.id);
    }
  });

  it("crée le profil à l'inscription, avec les défauts", async () => {
    const { data } = await users[0]!.client.from("profiles").select("*");
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: users[0]!.id,
      default_mode: "whisper",
      default_tier: "eco",
      monthly_budget_usd: 10,
    });
  });

  it("montre à A ses cours, sections et dépenses", async () => {
    const a = users[0]!.client;
    expect((await a.from("courses").select("id")).data).toEqual([{ id: courseOfA }]);
    expect((await a.from("sections").select("title")).data).toEqual([{ title: "S1" }]);
    const spend = await a.from("monthly_spend").select("spent_usd");
    expect(Number(spend.data?.[0]?.spent_usd)).toBe(1.25);
  });

  it("cache tout cela à B", async () => {
    const b = users[1]!.client;
    expect((await b.from("courses").select("id")).data).toEqual([]);
    expect((await b.from("sections").select("id")).data).toEqual([]);
    expect((await b.from("usage_events").select("id")).data).toEqual([]);
    expect((await b.from("monthly_spend").select("spent_usd")).data).toEqual([]);
    expect((await b.from("profiles").select("id")).data).toEqual([{ id: users[1]!.id }]);
  });

  it("interdit au navigateur d'écrire cours et dépenses", async () => {
    const a = users[0]!;
    const insert = await a.client.from("courses").insert({
      user_id: a.id,
      title: "Hors budget",
      source_kind: "text",
      mode: "whisper",
      tier: "express",
      quality: "standard",
      ambience: "rain",
    });
    expect(insert.error).not.toBeNull();
    await a.client.from("courses").update({ actual_cost_usd: 0 }).eq("id", courseOfA);
    await a.client.from("usage_events").delete().eq("user_id", a.id);
    const spend = await a.client.from("monthly_spend").select("spent_usd");
    expect(Number(spend.data?.[0]?.spent_usd)).toBe(1.25);
  });

  it("cache au navigateur les colonnes internes d'un cours et les fonctions de dépense", async () => {
    const a = users[0]!.client;
    expect((await a.from("courses").select("source_keys")).error).not.toBeNull();
    expect((await a.from("courses").select("trigger_run_id")).error).not.toBeNull();
    expect((await a.from("courses").select("*")).error).not.toBeNull();
    expect((await a.from("courses").select("id, title, status")).error).toBeNull();
    const since = new Date(0).toISOString();
    expect((await a.rpc("spend_since", { p_since: since })).error).not.toBeNull();
    expect((await a.rpc("course_cost", { p_course_id: courseOfA })).error).not.toBeNull();
    expect((await a.from("course_launches").select("id")).error).not.toBeNull();
    expect(Number((await admin.rpc("course_cost", { p_course_id: courseOfA })).data)).toBe(1.25);
    const costs = await a.from("course_costs").select("course_id, cost_usd");
    expect(costs.data).toEqual([{ course_id: courseOfA, cost_usd: 1.25 }]);
    expect((await users[1]!.client.from("course_costs").select("course_id")).data).toEqual([]);
  });

  it("réserve les agrégats du mode admin à la clé secrète", async () => {
    const a = users[0]!.client;
    const since = new Date(0).toISOString();
    expect((await a.rpc("admin_spend_by_month", {})).error).not.toBeNull();
    expect((await a.rpc("admin_spend_by_user", { p_since: since })).error).not.toBeNull();
    expect((await a.rpc("admin_spend_breakdown", {})).error).not.toBeNull();
    expect((await a.rpc("admin_course_counts")).error).not.toBeNull();

    const byUser = await admin.rpc("admin_spend_by_user", { p_since: since });
    expect(byUser.data?.find((r) => r.user_id === users[0]!.id)).toMatchObject({
      cost_usd: 1.25,
      courses: 1,
    });
    const breakdown = await admin.rpc("admin_spend_breakdown", { p_course_id: courseOfA });
    expect(breakdown.data).toEqual([
      expect.objectContaining({ step: "rewrite", model: "mock", cost_usd: 1.25, events: 1 }),
    ]);
    const months = await admin.rpc("admin_spend_by_month", { p_months: 1 });
    expect(Number(months.data?.at(-1)?.cost_usd)).toBeGreaterThanOrEqual(1.25);
    const counts = await admin.rpc("admin_course_counts");
    expect(counts.data?.some((r) => r.user_id === users[0]!.id)).toBe(true);
  });

  it("borne le budget et refuse un second cours en préparation", async () => {
    const a = users[0]!;
    const tooMuch = await a.client
      .from("profiles")
      .update({ monthly_budget_usd: 9999 })
      .eq("id", a.id);
    expect(tooMuch.error).not.toBeNull();
    const draft = {
      user_id: a.id,
      title: "En préparation",
      source_kind: "text",
      mode: "whisper" as const,
      tier: "eco" as const,
      quality: "standard" as const,
      ambience: "rain",
    };
    // `courseOfA` est déjà « queued » : la base refuse un deuxième cours actif.
    const second = await admin.from("courses").insert(draft);
    expect(second.error?.message).toContain("courses_one_active_per_user");
  });

  it("limite la progression d'écoute à ses propres cours", async () => {
    const [a, b] = [users[0]!, users[1]!];
    const own = await a.client
      .from("playback_progress")
      .upsert({ user_id: a.id, course_id: courseOfA, position_ms: 4200 });
    expect(own.error).toBeNull();
    const foreign = await b.client
      .from("playback_progress")
      .upsert({ user_id: b.id, course_id: courseOfA, position_ms: 1 });
    expect(foreign.error).not.toBeNull();
    const spoofed = await b.client
      .from("playback_progress")
      .upsert({ user_id: a.id, course_id: courseOfA, position_ms: 1 });
    expect(spoofed.error).not.toBeNull();
  });

  it("montre ses marques « pas compris » à leur autrice seule, sans écriture du navigateur", async () => {
    const [a, b] = [users[0]!, users[1]!];
    const mark = { user_id: a.id, course_id: courseOfA, position_ms: 1000, caption: "Passage." };
    expect((await admin.from("passage_marks").insert(mark)).error).toBeNull();
    expect((await a.client.from("passage_marks").select("caption")).data).toEqual([
      { caption: "Passage." },
    ]);
    expect((await b.client.from("passage_marks").select("id")).data).toEqual([]);
    expect((await a.client.from("passage_marks").insert(mark)).error).not.toBeNull();
    await a.client.from("passage_marks").delete().eq("course_id", courseOfA);
    expect((await a.client.from("passage_marks").select("id")).data).toHaveLength(1);
  });

  it("ouvre un cours partagé à sa destinataire, en lecture seule", async () => {
    const [a, b] = [users[0]!, users[1]!];
    const forged = await b.client.from("course_shares").insert({
      course_id: courseOfA,
      owner_id: a.id,
      owner_email: a.email,
      recipient_email: b.email,
    });
    expect(forged.error).not.toBeNull();
    expect((await b.client.from("courses").select("id")).data).toEqual([]);

    const share = await admin.from("course_shares").insert({
      course_id: courseOfA,
      owner_id: a.id,
      owner_email: a.email,
      recipient_email: b.email,
    });
    expect(share.error).toBeNull();

    expect((await b.client.from("courses").select("id")).data).toEqual([{ id: courseOfA }]);
    expect((await b.client.from("sections").select("title")).data).toEqual([{ title: "S1" }]);
    expect((await b.client.from("course_shares").select("owner_email")).data).toEqual([
      { owner_email: a.email },
    ]);
    expect((await a.client.from("course_shares").select("recipient_email")).data).toEqual([
      { recipient_email: b.email },
    ]);
    // Dépenses et écritures restent à la propriétaire.
    expect((await b.client.from("usage_events").select("id")).data).toEqual([]);
    expect((await b.client.from("monthly_spend").select("spent_usd")).data).toEqual([]);
    await b.client.from("courses").update({ title: "Piraté" }).eq("id", courseOfA);
    await b.client.from("course_shares").delete().eq("course_id", courseOfA);
    expect((await a.client.from("courses").select("title")).data).toEqual([
      { title: "Cours de A" },
    ]);

    const progress = await b.client
      .from("playback_progress")
      .upsert({ user_id: b.id, course_id: courseOfA, position_ms: 900 });
    expect(progress.error).toBeNull();
    const spoofed = await b.client
      .from("playback_progress")
      .upsert({ user_id: a.id, course_id: courseOfA, position_ms: 1 });
    expect(spoofed.error).not.toBeNull();

    await admin.from("course_shares").delete().eq("course_id", courseOfA);
    expect((await b.client.from("courses").select("id")).data).toEqual([]);
    expect((await b.client.from("sections").select("id")).data).toEqual([]);
  });

  it("garde les dossiers et le rangement propres à chaque compte, en lecture seule", async () => {
    const [a, b] = [users[0]!, users[1]!];
    const forged = await a.client.from("folders").insert({ user_id: a.id, name: "Forgé" });
    expect(forged.error).not.toBeNull();

    const folder = await admin
      .from("folders")
      .insert({ user_id: a.id, name: "Biologie" })
      .select("id")
      .single();
    if (folder.error) throw folder.error;
    const twin = await admin.from("folders").insert({ user_id: a.id, name: "biologie" });
    expect(twin.error?.code).toBe("23505");
    // Le même nom reste libre pour un autre compte.
    const ofB = await admin
      .from("folders")
      .insert({ user_id: b.id, name: "Biologie" })
      .select("id")
      .single();
    if (ofB.error) throw ofB.error;

    const placed = await admin
      .from("course_folders")
      .insert({ user_id: a.id, course_id: courseOfA, folder_id: folder.data.id });
    expect(placed.error).toBeNull();
    // Ranger dans le dossier d'un autre compte : refusé par la clé composite.
    const crossed = await admin
      .from("course_folders")
      .insert({ user_id: b.id, course_id: courseOfA, folder_id: folder.data.id });
    expect(crossed.error).not.toBeNull();

    expect((await a.client.from("folders").select("name")).data).toEqual([{ name: "Biologie" }]);
    expect((await a.client.from("course_folders").select("course_id, folder_id")).data).toEqual([
      { course_id: courseOfA, folder_id: folder.data.id },
    ]);
    expect((await b.client.from("folders").select("id")).data).toEqual([{ id: ofB.data.id }]);
    expect((await b.client.from("course_folders").select("course_id")).data).toEqual([]);

    await a.client.from("folders").update({ name: "Piraté" }).eq("id", folder.data.id);
    await a.client.from("course_folders").delete().eq("course_id", courseOfA);
    expect((await a.client.from("folders").select("name")).data).toEqual([{ name: "Biologie" }]);
    expect((await a.client.from("course_folders").select("course_id")).data).toHaveLength(1);

    // Supprimer le dossier sort le cours du dossier, sans toucher au cours.
    await admin.from("folders").delete().eq("id", folder.data.id);
    expect((await a.client.from("course_folders").select("course_id")).data).toEqual([]);
    expect((await a.client.from("courses").select("id")).data).toEqual([{ id: courseOfA }]);
  });

  it("ne laisse rien lire sans session", async () => {
    const anon: Client = createClient<Database>(url ?? "", publishableKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const res = await anon.from("courses").select("id");
    expect(res.data ?? []).toEqual([]);
  });
});
