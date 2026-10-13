import { auth } from "@trigger.dev/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { env, triggerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RealtimeAccess = { mode: "poll" } | { mode: "trigger"; runId: string; token: string };

/**
 * Accès temps réel au run d'un cours : un jeton public Trigger.dev limité à ce seul run,
 * en lecture, valable une heure. En mode inline, l'UI interroge simplement la base.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ message: "Connexion requise." }, { status: 401 });

  const courseId = z.uuid().safeParse(request.nextUrl.searchParams.get("courseId"));
  if (!courseId.success) return NextResponse.json({ message: "Cours invalide." }, { status: 400 });

  // Client de session : la RLS ne montre que ses cours et ceux partagés avec elle.
  const supabase = await createClient();
  const { data: visible } = await supabase
    .from("courses")
    .select("id, user_id")
    .eq("id", courseId.data)
    .maybeSingle();
  if (!visible) return NextResponse.json({ message: "Cours introuvable." }, { status: 404 });

  // Le jeton du run est réservé à la propriétaire : une destinataire de partage suit la base.
  if (env().JOBS_MODE === "inline" || visible.user_id !== user.id) {
    return NextResponse.json({ mode: "poll" } satisfies RealtimeAccess);
  }
  const { data: course } = await createAdminClient()
    .from("courses")
    .select("trigger_run_id")
    .eq("id", visible.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!course?.trigger_run_id) {
    return NextResponse.json({ mode: "poll" } satisfies RealtimeAccess);
  }
  triggerEnv();
  const token = await auth.createPublicToken({
    scopes: { read: { runs: [course.trigger_run_id] } },
    expirationTime: "1hr",
  });
  return NextResponse.json({
    mode: "trigger",
    runId: course.trigger_run_id,
    token,
  } satisfies RealtimeAccess);
}
