import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isAllowedEmail } from "@/lib/allowlist";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

/** Utilisatrice de la requête, ou `null`. Jeton vérifié, allowlist appliquée. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || typeof claims.email !== "string") return null;
  if (!isAllowedEmail(claims.email, env().ALLOWED_EMAILS)) return null;
  return { id: claims.sub, email: claims.email };
});

/** Pour les pages et Server Actions : redirige vers /login si personne n'est connecté. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
