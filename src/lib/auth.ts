import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { isAllowedEmail } from "@/lib/allowlist";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string; isAdmin: boolean };

/** Utilisatrice de la requête, ou `null`. Jeton vérifié, allowlist appliquée. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || typeof claims.email !== "string") return null;
  const { ALLOWED_EMAILS, ADMIN_EMAILS } = env();
  if (!isAllowedEmail(claims.email, ALLOWED_EMAILS)) return null;
  return {
    id: claims.sub,
    email: claims.email,
    isAdmin: isAllowedEmail(claims.email, ADMIN_EMAILS),
  };
});

/** Pour les pages et Server Actions : redirige vers /login si personne n'est connecté. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Pour le mode admin : une page qui n'existe pas pour les autres comptes. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
