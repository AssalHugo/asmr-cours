import "server-only";
import { parseServerEnv, requireKeys, type ServerEnv } from "./env.schema";

let cached: ServerEnv | undefined;

/** Environnement serveur validé (évalué à la première lecture, pas à l'import). */
export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export const supabaseEnv = () =>
  requireKeys(env(), "Supabase", [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ] as const);

export const supabaseAdminEnv = () =>
  requireKeys(env(), "Supabase (clé secrète)", [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
  ] as const);

export const geminiEnv = () => requireKeys(env(), "Gemini", ["GEMINI_API_KEY"] as const);

export const r2Env = () =>
  requireKeys(env(), "Cloudflare R2", [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ] as const);

export const triggerEnv = () =>
  requireKeys(env(), "Trigger.dev", ["TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_REF"] as const);
