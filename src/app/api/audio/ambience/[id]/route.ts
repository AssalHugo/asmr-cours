import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isAmbienceId, SYNTHETIC_AMBIENCE_ID } from "@/lib/ambiences";
import { synthesizeAmbience } from "@/lib/audio/ambience-synth";
import { env } from "@/lib/env";
import { keys, PRESIGN_GET_SECONDS, storage } from "@/lib/storage";

/** Adresse stable du fichier web d'une ambiance (boucle courte décodée par le lecteur). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const id = (await context.params).id.replace(/\.m4a$/, "");
  if (!isAmbienceId(id)) return new NextResponse(null, { status: 404 });
  const key = keys.ambienceWeb(id);
  if (!(await storage().head(key))) {
    // Bruit rose (et doublures du mode mock) : fabriqué à la demande, là où FFmpeg existe.
    const synthetic = id === SYNTHETIC_AMBIENCE_ID || env().AI_MODE === "mock";
    if (!synthetic || env().JOBS_MODE !== "inline") return new NextResponse(null, { status: 404 });
    await synthesizeAmbience(storage(), id);
  }
  const url = await storage().presignGet(key, { expiresIn: PRESIGN_GET_SECONDS });
  return new NextResponse(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
