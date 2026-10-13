"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth";
import { fail, SettingsInput, type ActionResult } from "@/lib/course-input";
import { createClient } from "@/lib/supabase/server";

export async function saveSettings(raw: unknown): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("Ta session a expiré. Reconnecte-toi.");
  const parsed = SettingsInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Réglages invalides.");
  const input = parsed.data;

  // Client de session : la RLS limite la mise à jour à son propre profil.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName || null,
      default_voice_id: input.defaultVoiceId,
      default_mode: input.defaultMode,
      default_ambience: input.defaultAmbience,
      default_tier: input.defaultTier,
      default_quality: input.defaultQuality,
      address_form: input.addressForm,
      monthly_budget_usd: input.monthlyBudgetUsd,
    })
    .eq("id", user.id);
  if (error) return fail("Les réglages n'ont pas pu être enregistrés.");
  revalidatePath("/settings");
  return { ok: true };
}
