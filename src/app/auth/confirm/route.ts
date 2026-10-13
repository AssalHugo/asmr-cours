import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAllowedEmail } from "@/lib/allowlist";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = ["email", "magiclink", "signup"] as const satisfies readonly EmailOtpType[];

const Query = z.union([
  z.object({ token_hash: z.string().min(1), type: z.enum(OTP_TYPES).default("email") }),
  z.object({ code: z.string().min(1) }),
]);

/** Arrivée du lien magique : `token_hash` (modèle d'email du projet) ou `code` (PKCE). */
export async function GET(request: NextRequest) {
  const failure = NextResponse.redirect(new URL("/login?erreur=lien", request.url));
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return failure;

  const supabase = await createClient();
  const { data, error } =
    "code" in parsed.data
      ? await supabase.auth.exchangeCodeForSession(parsed.data.code)
      : await supabase.auth.verifyOtp(parsed.data);
  if (error) return failure;

  if (!isAllowedEmail(data.user?.email, env().ALLOWED_EMAILS)) {
    await supabase.auth.signOut();
    return failure;
  }
  return NextResponse.redirect(new URL("/library", request.url));
}
