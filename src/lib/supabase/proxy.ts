import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/allowlist";

const PUBLIC_PREFIXES = ["/login", "/auth/"];

/**
 * Rafraîchit la session (seul endroit où le jeton est renouvelé) et renvoie
 * vers /login les visites non connectées. Les routes /api répondent 401 elles-mêmes.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  // Ne rien exécuter entre la création du client et getClaims().
  const { data } = await supabase.auth.getClaims();
  // Même règle que `getUser` : une session dont l'adresse n'est plus invitée ne compte pas
  // comme connectée, sinon /login et /library se renverraient la visite sans fin.
  const email = data?.claims?.email;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  const signedIn =
    Boolean(data?.claims?.sub) && typeof email === "string" && isAllowedEmail(email, allowed);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  const isApi = pathname.startsWith("/api/");

  if (!signedIn && !isPublic && !isApi) return redirectKeepingCookies(request, response, "/login");
  if (signedIn && pathname === "/login")
    return redirectKeepingCookies(request, response, "/library");
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(name);
    if (value) redirect.headers.set(name, value);
  }
  return redirect;
}
