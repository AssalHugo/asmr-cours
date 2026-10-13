import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdminEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | undefined;

/**
 * Client à clé secrète : contourne la RLS. Serveur et tâches uniquement,
 * et chaque requête doit filtrer par `user_id`.
 */
export function createAdminClient(): AdminClient {
  if (!cached) {
    const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = supabaseAdminEnv();
    cached = createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
