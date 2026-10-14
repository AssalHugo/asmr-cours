"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/course-input";
import { keys, PRESIGN_PUT_SECONDS, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  baseMime,
  CreateMessageInput,
  MAX_MESSAGE_BYTES,
  messageExtension,
  PrepareMessageInput,
} from "@/lib/voice-messages";

const FORBIDDEN = fail("Réservé au mode admin.");

async function adminUser() {
  const user = await getUser();
  return user?.isAdmin ? user : null;
}

async function findCourse(courseId: string) {
  const { data } = await createAdminClient()
    .from("courses")
    .select("id, user_id, duration_ms")
    .eq("id", courseId)
    .maybeSingle();
  return data;
}

function messageKey(courseId: string, messageId: string, mime: string): string {
  return keys.voiceMessage(courseId, messageId, messageExtension(mime) ?? "bin");
}

/** URL présignée pour déposer l'enregistrement, avant de créer le message. */
export async function prepareVoiceMessage(
  raw: unknown,
): Promise<ActionResult<{ messageId: string; url: string; headers: Record<string, string> }>> {
  if (!(await adminUser())) return FORBIDDEN;
  const input = PrepareMessageInput.safeParse(raw);
  if (!input.success) return fail("Enregistrement invalide (format ou taille).");
  const { courseId, mime, bytes } = input.data;
  if (!(await findCourse(courseId))) return fail("Ce cours n'existe plus.");

  const messageId = randomUUID();
  const signed = await storage().presignPut(messageKey(courseId, messageId, mime), {
    contentType: baseMime(mime),
    bytes,
    expiresIn: PRESIGN_PUT_SECONDS,
  });
  return { ok: true, data: { messageId, ...signed } };
}

/** Enregistre le message une fois le fichier déposé. */
export async function createVoiceMessage(raw: unknown): Promise<ActionResult> {
  const user = await adminUser();
  if (!user) return FORBIDDEN;
  const input = CreateMessageInput.safeParse(raw);
  if (!input.success) return fail("Message invalide.");
  const { courseId, messageId, mime, durationMs, atMs } = input.data;
  const course = await findCourse(courseId);
  if (!course) return fail("Ce cours n'existe plus.");
  if (atMs !== null && course.duration_ms !== null && atMs >= course.duration_ms) {
    return fail("Ce moment dépasse la fin du cours.");
  }

  const key = messageKey(courseId, messageId, mime);
  const info = await storage().head(key);
  if (!info) return fail("L'enregistrement n'est pas arrivé. Réessaie.");
  if (info.bytes > MAX_MESSAGE_BYTES) {
    await storage().delete(key);
    return fail("Enregistrement trop lourd.");
  }

  const { error } = await createAdminClient()
    .from("voice_messages")
    .insert({
      id: messageId,
      course_id: courseId,
      sender_id: user.id,
      recipient_id: course.user_id,
      storage_key: key,
      mime: baseMime(mime),
      duration_ms: durationMs,
      at_ms: atMs,
    });
  if (error) return fail("Le message n'a pas pu être enregistré.");
  revalidatePath(`/admin/courses/${courseId}`);
  return { ok: true };
}

export async function deleteVoiceMessage(messageId: string): Promise<ActionResult> {
  if (!(await adminUser())) return FORBIDDEN;
  const id = z.uuid().safeParse(messageId);
  if (!id.success) return fail("Message introuvable.");
  const admin = createAdminClient();
  const { data } = await admin
    .from("voice_messages")
    .delete()
    .eq("id", id.data)
    .select("course_id, storage_key")
    .maybeSingle();
  if (!data) return fail("Message introuvable.");
  await storage()
    .delete(data.storage_key)
    .catch(() => undefined);
  revalidatePath(`/admin/courses/${data.course_id}`);
  return { ok: true };
}
