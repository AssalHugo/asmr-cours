"use server";

import { z } from "zod";
import { isAllowedEmail } from "@/lib/allowlist";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

const LoginInput = z.object({ email: z.email().trim().toLowerCase() });

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Cette adresse ne ressemble pas à un email." };
  }
  const { email } = parsed.data;

  if (!isAllowedEmail(email, env().ALLOWED_EMAILS)) {
    return {
      status: "error",
      email,
      message: "Murmure est un espace privé, et cette adresse n'y est pas invitée. Désolée !",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env().APP_URL}/auth/confirm`, shouldCreateUser: true },
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
