import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { isAmbienceId } from "@/lib/ambiences";
import { keys, PRESIGN_GET_SECONDS, storage } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const Params = z.object({ courseId: z.uuid(), file: z.string().max(60) });

/**
 * Adresse stable d'un fichier de cours : redirige vers une URL présignée courte.
 * Le lecteur et le cache hors-ligne n'utilisent que cette adresse, indépendante de la
 * signature. Fichiers : voice.m4a, mix-{ambiance}.m4a, chapters.json, captions.json.
 */
export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const params = Params.safeParse(await context.params);
  if (!params.success) return new NextResponse(null, { status: 404 });
  const { courseId, file } = params.data;

  // Client de session : la RLS ne montre que ses cours et ceux partagés avec elle.
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return new NextResponse(null, { status: 404 });

  const mix = /^mix-([a-z0-9-]+)\.m4a$/.exec(file)?.[1];
  const key =
    file === "voice.m4a"
      ? keys.voice(courseId)
      : file === "chapters.json"
        ? keys.chapters(courseId)
        : file === "captions.json"
          ? keys.captions(courseId)
          : mix && isAmbienceId(mix)
            ? keys.mix(courseId, mix)
            : null;
  if (!key) return new NextResponse(null, { status: 404 });

  const url = await storage().presignGet(key, { expiresIn: PRESIGN_GET_SECONDS });
  return new NextResponse(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
