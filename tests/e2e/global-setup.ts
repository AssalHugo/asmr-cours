import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const TEST_EMAIL = "test@murmure.local";

/**
 * Connexion de test sans passer par la boîte mail : la clé secrète du Supabase LOCAL
 * fabrique un lien magique, que le navigateur ouvre comme le ferait l'utilisatrice.
 * Aucun contournement n'existe dans l'app elle-même. Les cours du compte de test sont
 * effacés avant chaque campagne (limite d'un cours actif et de cinq cours par jour).
 */
export default async function globalSetup(config: FullConfig) {
  const env = {
    ...(existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {}),
    ...process.env,
  };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error(
      "E2E : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY sont requis (pnpm db:start).",
    );
  if (!/127\.0\.0\.1|localhost/.test(url))
    throw new Error("E2E : refus de tourner contre un Supabase qui n'est pas local.");

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: TEST_EMAIL });
  if (link.error) throw link.error;
  await admin.from("courses").delete().eq("user_id", link.data.user.id);
  await admin.from("usage_events").delete().eq("user_id", link.data.user.id);

  const project = config.projects[0];
  const baseURL = project?.use.baseURL ?? "http://localhost:3100";
  mkdirSync("test-results", { recursive: true });
  const browser = await chromium.launch(project?.use.launchOptions);
  const page = await browser.newPage();
  await page.goto(
    `${baseURL}/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=email`,
  );
  await page.waitForURL("**/library");
  await page.context().storageState({ path: "test-results/session.json" });
  await browser.close();
}
