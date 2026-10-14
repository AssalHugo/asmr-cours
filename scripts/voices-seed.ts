/**
 * Crée les presets de voix (docs/SPEC.md §9.4) dans le projet Gemini de la clé courante,
 * et les rattache à chaque compte existant. À lancer une fois par projet (dev, puis prod).
 * Usage : pnpm voices:seed [--fr]
 *   --fr  utilise les descriptions rédigées en français, pour comparer à l'oreille
 * L'extrait brut renvoyé par Gemini est écrit dans .data/voices-seed/. L'aperçu fidèle à un
 * cours (texte fixe, mastering) est généré à la première écoute dans le Studio voix.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { aiProviders } from "@/lib/ai";
import { env } from "@/lib/env";
import { VOICE_PRESETS, VOICE_PRESETS_FR } from "@/lib/prompts/voice-presets";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const e = env();
  const ai = aiProviders();
  const admin = createAdminClient();
  const french = process.argv.includes("--fr");
  const presets = french ? VOICE_PRESETS_FR : VOICE_PRESETS;
  const suffix = french ? " (fr)" : "";

  const { data: profiles, error } = await admin.from("profiles").select("id");
  if (error) throw new Error(error.message);
  if (!profiles || profiles.length === 0) {
    throw new Error(
      "Aucun compte : connecte-toi une première fois à l'app, puis relance ce script.",
    );
  }
  await mkdir(".data/voices-seed", { recursive: true });

  for (const preset of presets) {
    const label = `${preset.label}${suffix}`;
    const { data: existing } = await admin
      .from("voices")
      .select("provider_voice_id")
      .eq("env", e.APP_ENV)
      .eq("label", label)
      .limit(1);
    let providerVoiceId = existing?.[0]?.provider_voice_id;

    if (!providerVoiceId) {
      const voice = await ai.voices.design({
        description: preset.description,
        label,
        model: ai.models.tts,
        gender: preset.gender,
      });
      providerVoiceId = voice.providerVoiceId;
      console.log(`✓ ${label} créée dans le projet ${e.APP_ENV} : ${providerVoiceId}`);
      if (voice.sampleWav) {
        await writeFile(
          `.data/voices-seed/${preset.slug}${french ? "-fr" : ""}.wav`,
          voice.sampleWav,
        );
      }
    } else {
      console.log(`· ${label} existe déjà (${providerVoiceId})`);
    }

    for (const profile of profiles) {
      const { data: own } = await admin
        .from("voices")
        .select("id")
        .eq("user_id", profile.id)
        .eq("env", e.APP_ENV)
        .eq("provider_voice_id", providerVoiceId)
        .limit(1);
      if (own && own.length > 0) continue;
      const { error: insertError } = await admin.from("voices").insert({
        user_id: profile.id,
        env: e.APP_ENV,
        provider: ai.mock ? "mock" : "gemini",
        provider_voice_id: providerVoiceId,
        kind: "designed",
        label,
        description: preset.description,
      });
      if (insertError) throw new Error(insertError.message);
    }
  }
  console.log("Terminé. Écoute les échantillons dans le Studio voix, ou dans .data/voices-seed/.");
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
