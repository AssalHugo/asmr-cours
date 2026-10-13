"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser, type SessionUser } from "@/lib/auth";
import {
  CreateFolderInput,
  fail,
  MoveCourseInput,
  RenameFolderInput,
  type ActionResult,
} from "@/lib/course-input";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SIGNED_OUT = fail("Ta session a expiré. Reconnecte-toi.");
const MAX_FOLDERS_PER_USER = 50;
const UNIQUE_VIOLATION = "23505";
const DUPLICATE = fail("Un dossier porte déjà ce nom.");
const FOLDER_GONE = fail("Ce dossier n'existe plus.");

async function ownFolder(user: SessionUser, folderId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("folders")
    .select("id")
    .eq("id", folderId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data !== null;
}

/**
 * Range un cours dans un dossier du compte, ou l'en sort (`folderId` nul). Le cours est lu avec
 * la session : la RLS ne laisse passer que ses propres cours et ceux reçus en partage.
 */
async function place(
  user: SessionUser,
  courseId: string,
  folderId: string | null,
): Promise<ReturnType<typeof fail> | null> {
  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return fail("Ce cours n'existe plus.");

  const admin = createAdminClient();
  const { error } =
    folderId === null
      ? await admin.from("course_folders").delete().eq("user_id", user.id).eq("course_id", courseId)
      : await admin
          .from("course_folders")
          .upsert(
            { user_id: user.id, course_id: courseId, folder_id: folderId },
            { onConflict: "user_id,course_id" },
          );
  return error ? fail("Le rangement a échoué. Réessaie.") : null;
}

export async function createFolder(raw: unknown): Promise<ActionResult<{ folderId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = CreateFolderInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nom invalide.");
  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("folders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countError) return fail("Le dossier n'a pas pu être créé. Réessaie.");
  if ((count ?? 0) >= MAX_FOLDERS_PER_USER) {
    return fail(`Tu as déjà ${MAX_FOLDERS_PER_USER} dossiers. Supprimes-en un d'abord.`);
  }

  const { data, error } = await admin
    .from("folders")
    .insert({ user_id: user.id, name: parsed.data.name })
    .select("id")
    .single();
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? DUPLICATE
      : fail("Le dossier n'a pas pu être créé. Réessaie.");
  }
  if (parsed.data.courseId) {
    const refused = await place(user, parsed.data.courseId, data.id);
    if (refused) return refused;
  }
  revalidatePath("/library");
  return { ok: true, data: { folderId: data.id } };
}

export async function renameFolder(raw: unknown): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = RenameFolderInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nom invalide.");
  const { data, error } = await createAdminClient()
    .from("folders")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.folderId)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    return error.code === UNIQUE_VIOLATION ? DUPLICATE : fail("Le renommage a échoué. Réessaie.");
  }
  if (data.length === 0) return FOLDER_GONE;
  revalidatePath("/library");
  return { ok: true };
}

/** Supprime un dossier : ses cours restent dans la bibliothèque, hors de tout dossier. */
export async function deleteFolder(folderId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!z.uuid().safeParse(folderId).success) return FOLDER_GONE;
  const { error } = await createAdminClient()
    .from("folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", user.id);
  if (error) return fail("La suppression a échoué. Réessaie.");
  revalidatePath("/library");
  return { ok: true };
}

export async function moveCourse(raw: unknown): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = MoveCourseInput.safeParse(raw);
  if (!parsed.success) return fail("Rangement invalide.");
  const { courseId, folderId } = parsed.data;
  if (folderId !== null && !(await ownFolder(user, folderId))) return FOLDER_GONE;
  const refused = await place(user, courseId, folderId);
  if (refused) return refused;
  revalidatePath("/library");
  return { ok: true };
}
