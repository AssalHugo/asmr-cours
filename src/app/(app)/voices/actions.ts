"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiProviders } from "@/lib/ai";
import { parseWav } from "@/lib/audio/wav";
import { getUser } from "@/lib/auth";
import { fail, VoiceDesignInput, type ActionResult } from "@/lib/course-input";
import { billingModels, getMonthlySpend, getProfile } from "@/lib/data";
import { env } from "@/lib/env";
import { runVoiceSample } from "@/lib/jobs";
import { TTS_STYLE } from "@/lib/pipeline/chunker";
import { costUsd } from "@/lib/pricing";
import { VOICE_PREVIEW_SEGMENTS } from "@/lib/prompts/voice-presets";
import { keys, PRESIGN_GET_SECONDS, storage } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SIGNED_OUT = fail("Ta session a expiré. Reconnecte-toi.");
/** Gemini plafonne à 200 voix stockées par projet : on garde de la marge. */
const MAX_VOICES_PER_USER = 40;
const PROVIDER_VOICE_ID = /^(voice_|mock_voice_)[A-Za-z0-9_-]{6,120}$/;

/** Une lecture ratée compte comme un budget atteint : le garde-fou refuse plutôt que de laisser passer. */
async function overBudget(userId: string): Promise<boolean> {
  if (billingModels().mock) return false;
  try {
    const [profile, spent] = await Promise.all([getProfile(userId), getMonthlySpend()]);
    return spent >= Number(profile.monthly_budget_usd);
  } catch {
    return true;
  }
}

/**
 * Supprime chez Gemini un brouillon de voix, jamais une voix enregistrée : l'identifiant
 * vient du navigateur, et une voix gardée (par ce compte ou un autre) doit survivre.
 */
async function removeDraft(providerVoiceId: string): Promise<void> {
  if (!PROVIDER_VOICE_ID.test(providerVoiceId)) return;
  const { count, error } = await createAdminClient()
    .from("voices")
    .select("id", { count: "exact", head: true })
    .eq("provider_voice_id", providerVoiceId);
  if (error || (count ?? 0) > 0) return;
  await aiProviders()
    .voices.remove(providerVoiceId)
    .catch(() => undefined);
}

/** « Écouter la voix » : échantillon mis en cache par voix × mode. */
export async function previewVoice(
  voiceId: string,
  mode: "whisper" | "soft",
): Promise<ActionResult<{ url: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = z
    .object({ voiceId: z.uuid(), mode: z.enum(["whisper", "soft"]) })
    .safeParse({ voiceId, mode });
  if (!parsed.success) return fail("Voix invalide.");
  const supabase = await createClient();
  const { data: voice } = await supabase
    .from("voices")
    .select("id")
    .eq("id", voiceId)
    .maybeSingle();
  if (!voice) return fail("Cette voix n'existe plus.");

  const key = keys.voiceSample(voiceId, mode);
  if (!(await storage().head(key))) {
    if (await overBudget(user.id)) return fail("Le budget du mois est atteint.", "over_budget");
    try {
      await runVoiceSample({ voiceId, userId: user.id, mode });
    } catch {
      return fail("L'échantillon n'a pas pu être généré. Réessaie dans un instant.");
    }
  }
  return {
    ok: true,
    data: { url: await storage().presignGet(key, { expiresIn: PRESIGN_GET_SECONDS }) },
  };
}

export type VoiceDraft = { providerVoiceId: string; sample: string | null };

/**
 * Essai de voice design : crée une voix à partir d'une description et renvoie son
 * échantillon. Les essais passent par le modèle TTS standard ; un brouillon non gardé est supprimé.
 */
export async function tryVoiceDesign(
  raw: unknown,
  previousDraftId?: string,
): Promise<ActionResult<VoiceDraft>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = VoiceDesignInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Description invalide.");
  if (await overBudget(user.id)) return fail("Le budget du mois est atteint.", "over_budget");

  const ai = aiProviders();
  if (previousDraftId) await removeDraft(previousDraftId);
  try {
    const model = ai.models.tts;
    const draft = await ai.voices.design({
      description: parsed.data.description,
      label: `Brouillon ${new Date().toISOString().slice(0, 16)}`,
      model,
    });
    if (draft.sampleWav) {
      const seconds = parseWav(draft.sampleWav).durationMs / 1000;
      const usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, audioSeconds: seconds };
      await createAdminClient()
        .from("usage_events")
        .insert({
          user_id: user.id,
          step: "voice-design",
          model,
          tier: "standard",
          audio_seconds: Number(seconds.toFixed(2)),
          cost_usd: Number(costUsd(model, "standard", usage, new Date()).toFixed(5)),
        });
    }
    return {
      ok: true,
      data: {
        providerVoiceId: draft.providerVoiceId,
        sample: draft.sampleWav
          ? `data:audio/wav;base64,${draft.sampleWav.toString("base64")}`
          : null,
      },
    };
  } catch (error) {
    console.error("Échec de tryVoiceDesign :", error);
    return fail("Gemini n'a pas pu créer cette voix. Reformule la description et réessaie.");
  }
}

/** Abandonne un brouillon de voix : il est supprimé côté Gemini. */
export async function discardVoiceDraft(providerVoiceId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!PROVIDER_VOICE_ID.test(providerVoiceId)) return fail("Brouillon invalide.");
  await removeDraft(providerVoiceId);
  return { ok: true };
}

/** Garde la voix essayée : elle rejoint la liste, avec un échantillon final au modèle standard. */
export async function saveDesignedVoice(raw: unknown): Promise<ActionResult<{ voiceId: string }>> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const parsed = z
    .object({
      providerVoiceId: z.string().regex(PROVIDER_VOICE_ID),
      label: z.string().trim().min(1, "Donne un nom à cette voix.").max(60),
      description: z.string().trim().max(600),
    })
    .safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Voix invalide.");

  const admin = createAdminClient();
  const appEnv = env().APP_ENV;
  const { count } = await admin
    .from("voices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("env", appEnv);
  if ((count ?? 0) >= MAX_VOICES_PER_USER) {
    return fail(`Tu as déjà ${MAX_VOICES_PER_USER} voix. Supprimes-en une avant d'en ajouter.`);
  }

  const ai = aiProviders();
  const { data: voice, error } = await admin
    .from("voices")
    .insert({
      user_id: user.id,
      env: appEnv,
      provider: ai.mock ? "mock" : "gemini",
      provider_voice_id: parsed.data.providerVoiceId,
      kind: "designed",
      label: parsed.data.label,
      description: parsed.data.description,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return fail("La voix n'a pas pu être enregistrée.");

  // Échantillon final au modèle standard, stocké pour les écoutes suivantes.
  try {
    const model = ai.models.tts;
    const key = keys.voiceSample(voice.id, "whisper");
    const result = await ai.tts.synthesize({
      key,
      text: ai.tts.renderChunkText([...VOICE_PREVIEW_SEGMENTS]),
      voiceId: parsed.data.providerVoiceId,
      style: TTS_STYLE.whisper,
      model,
    });
    await storage().put(key, result.wav, "audio/wav");
    await admin.from("voices").update({ sample_key: key }).eq("id", voice.id);
    await admin.from("usage_events").insert({
      user_id: user.id,
      step: "voice-sample",
      model,
      tier: "standard",
      input_tokens: result.usage.inputTokens,
      audio_seconds: Number(result.usage.audioSeconds.toFixed(2)),
      cost_usd: Number(costUsd(model, "standard", result.usage, new Date()).toFixed(5)),
    });
  } catch {
    // La voix est gardée ; l'échantillon sera généré à la première écoute.
  }
  revalidatePath("/voices");
  return { ok: true, data: { voiceId: voice.id } };
}

export async function setDefaultVoice(voiceId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const supabase = await createClient();
  const { data: voice } = await supabase
    .from("voices")
    .select("id")
    .eq("id", voiceId)
    .maybeSingle();
  if (!voice) return fail("Cette voix n'existe plus.");
  if (!z.uuid().safeParse(voiceId).success) return fail("Cette voix n'existe plus.");
  const { error } = await supabase
    .from("profiles")
    .update({ default_voice_id: voiceId })
    .eq("id", user.id);
  if (error) return fail("Le choix n'a pas pu être enregistré.");
  revalidatePath("/voices");
  return { ok: true };
}

/** Supprime une voix créée. Les voix prédéfinies ne se suppriment pas. */
export async function removeVoice(voiceId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const supabase = await createClient();
  const { data: voice } = await supabase.from("voices").select("*").eq("id", voiceId).maybeSingle();
  if (!voice) return fail("Cette voix n'existe plus.");
  if (voice.kind === "prebuilt") return fail("Une voix prédéfinie ne se supprime pas.");

  const admin = createAdminClient();
  const { count } = await admin
    .from("voices")
    .select("id", { count: "exact", head: true })
    .eq("provider_voice_id", voice.provider_voice_id);
  // Une même voix Gemini peut être partagée (presets) : on ne la supprime que pour le dernier lien.
  if ((count ?? 0) <= 1)
    await aiProviders()
      .voices.remove(voice.provider_voice_id)
      .catch(() => undefined);
  await storage().deletePrefix(`voices/${voice.id}/`);
  const { error } = await admin.from("voices").delete().eq("id", voiceId).eq("user_id", user.id);
  if (error) return fail("La suppression a échoué.");
  revalidatePath("/voices");
  return { ok: true };
}
