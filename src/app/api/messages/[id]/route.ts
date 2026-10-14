import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { PRESIGN_GET_SECONDS, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/** Audio d'un message vocal : pour sa destinataire et pour le mode admin. */
export async function GET(_request: Request, context: { params: Promise<unknown> }) {
  const user = await getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const params = z.object({ id: z.uuid() }).safeParse(await context.params);
  if (!params.success) return new NextResponse(null, { status: 404 });

  let query = createAdminClient()
    .from("voice_messages")
    .select("storage_key")
    .eq("id", params.data.id);
  if (!user.isAdmin) query = query.eq("recipient_id", user.id);
  const { data } = await query.maybeSingle();
  if (!data) return new NextResponse(null, { status: 404 });

  const url = await storage().presignGet(data.storage_key, { expiresIn: PRESIGN_GET_SECONDS });
  return new NextResponse(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
