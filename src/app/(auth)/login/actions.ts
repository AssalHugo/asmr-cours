"use server";

import { z } from "zod";
import { isAllowedEmail } from "@/lib/allowlist";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

// On rogne avant de valider : un espace glissé par le clavier du téléphone ne doit pas tout refuser.
const LoginInput = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

/**
 * Les inscriptions sont fermées côté Supabase (docs/SETUP.md) : seul le serveur crée un
 * compte, et seulement pour une adresse invitée. Personne ne peut donc obtenir de session
 * en appelant l'API d'authentification directement avec la clé publique.
 */
async function ensureAccount(email: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  // Erreur = compte déjà créé, le cas courant. Tout autre souci ressortira à l'envoi du lien.
  if (error || !data.user) return;
  await admin
    .from("profiles")
    .update({ monthly_budget_usd: env().MONTHLY_BUDGET_USD })
    .eq("id", data.user.id);
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Cette adresse ne ressemble pas à un email." };
  }
  const { email } = parsed.data;

  // Même réponse que pour une adresse invitée : le formulaire ne dit pas qui a accès.
  if (!isAllowedEmail(email, env().ALLOWED_EMAILS)) return { status: "sent", email };

  await ensureAccount(email);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env().APP_URL}/auth/confirm`, shouldCreateUser: false },
  });
  if (error) {
    return {
      status: "error",
      email,
      message:
        error.status === 429
          ? "Un lien vient déjà de partir. Patiente une minute avant de réessayer."
          : "Le lien n'a pas pu être envoyé. Réessaie dans un instant.",
    };
  }
  return { status: "sent", email };
}
