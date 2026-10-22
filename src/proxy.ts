import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tout sauf les fichiers statiques, le service worker, la page hors-ligne et le manifest.
    // Le stockage de dev (`STORAGE_MODE=local`) contrôle lui-même la session : passé par le
    // proxy, un dépôt serait tronqué à 10 Mo (`proxyClientMaxBodySize`).
    "/((?!_next/static|_next/image|favicon.ico|serwist/|api/dev-storage/|~offline|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
