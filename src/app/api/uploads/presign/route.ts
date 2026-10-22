import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { keys, PRESIGN_PUT_SECONDS, storage } from "@/lib/storage";
import { uploadFileName } from "@/lib/storage/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkUploadRequest, PresignRequest, type PresignResponse } from "@/lib/uploads";

/** Délivre des URLs présignées PUT pour déposer les sources d'un futur cours. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ message: "Connexion requise." }, { status: 401 });

  const parsed = PresignRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Demande invalide." }, { status: 400 });

  const check = checkUploadRequest(parsed.data, {
    maxUploadMb: env().MAX_UPLOAD_MB,
    maxBinderMb: env().MAX_BINDER_MB,
  });
  if (!check.ok) return NextResponse.json({ message: check.message }, { status: 422 });

  // Changer de fichier dans l'assistant ne laisse pas l'ancien dépôt orphelin.
  const { replaces } = parsed.data;
  if (replaces) {
    const { data: existing, error } = await createAdminClient()
      .from("courses")
      .select("id")
      .eq("id", replaces)
      .maybeSingle();
    if (!existing && !error) {
      await storage()
        .deletePrefix(keys.uploadPrefix(user.id, replaces))
        .catch(() => undefined);
    }
  }

  const courseId = randomUUID();
  const uploads = await Promise.all(
    parsed.data.files.map(async (file, index) => {
      const ext = check.extensions[index] ?? "bin";
      const key = keys.upload(user.id, courseId, uploadFileName(index, randomUUID(), ext));
      const signed = await storage().presignPut(key, {
        contentType: file.type.toLowerCase(),
        bytes: file.size,
        expiresIn: PRESIGN_PUT_SECONDS,
      });
      return { key, ...signed };
    }),
  );

  return NextResponse.json({ courseId, uploads } satisfies PresignResponse);
}
