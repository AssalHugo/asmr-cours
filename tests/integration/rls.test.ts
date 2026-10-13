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
  const admin: Client = createClient<Database>(url ?? "", secretKey ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users: { id: string; client: Client }[] = [];
  let courseOfA = "";

  async function signUp(): Promise<{ id: string; client: Client }> {
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
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
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
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
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

  it("ne laisse rien lire sans session", async () => {
    const anon: Client = createClient<Database>(url ?? "", publishableKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const res = await anon.from("courses").select("id");
    expect(res.data ?? []).toEqual([]);
  });
});
