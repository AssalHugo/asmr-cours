import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques, le service worker, la page hors-ligne et le manifest.
    "/((?!_next/static|_next/image|favicon.ico|serwist/|~offline|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
