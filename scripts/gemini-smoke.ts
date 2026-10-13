/**
 * Un appel réel par fonction Gemini, sur un texte de test minuscule (quelques centimes au plus).
 * Usage : pnpm gemini:smoke [--batch] [--voice]
 *   --voice  crée puis supprime une voix designée
 *   --batch  soumet un job Batch TTS d'un chunk (clé prod requise : pas de batch en free tier)
 * À lancer avec la clé dev d'abord. N'y mets que des textes de test : le free tier réutilise les données.
 */
import { writeFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { getSpeechBatch, readSpeechBatchResults, submitSpeechBatch } from "@/lib/gemini/batch";
import { synthesizeSpeech } from "@/lib/gemini/tts";
import { deleteVoice, designVoice } from "@/lib/gemini/voices";
import { createGeminiLlm } from "@/lib/llm/gemini";
import { renderGeminiChunkText, TTS_STYLE } from "@/lib/pipeline/chunker";
import { costUsd } from "@/lib/pricing";
import {
  PREBUILT_VOICES,
  VOICE_PRESETS,
  VOICE_PREVIEW_SEGMENTS,
} from "@/lib/prompts/voice-presets";

const SOURCE =
  "La photosynthèse transforme l'énergie lumineuse en énergie chimique. Elle a lieu dans les chloroplastes. " +
  "Elle consomme de l'eau et du dioxyde de carbone, et produit du glucose et du dioxygène.";

async function main() {
  const e = env();
  const flags = new Set(process.argv.slice(2));
  const llm = createGeminiLlm();
  const now = new Date();
  let total = 0;

  console.log("=========================================");
  console.log("💨 Murmure — Smoke test Gemini API");
  console.log("=========================================");
  console.log(`• Environnement : ${e.APP_ENV}`);
  const keyPreview = e.GEMINI_API_KEY
    ? `présente (***${e.GEMINI_API_KEY.slice(-4)})`
    : "non renseignée";
  console.log(`• Clé Gemini    : ${keyPreview}`);
  console.log(
    `• Modèles texte : ${e.GEMINI_MODEL_TEXT} (rédaction) | ${e.GEMINI_MODEL_CHECK} (contrôle)`,
  );
  console.log(
    `• Modèles TTS   : ${e.GEMINI_MODEL_TTS_LITE} (éco) | ${e.GEMINI_MODEL_TTS} (standard)`,
  );
  console.log(
    `• Options       : ${
      [flags.has("--voice") ? "--voice" : null, flags.has("--batch") ? "--batch" : null]
        .filter(Boolean)
        .join(", ") || "standard"
    }`,
  );
  console.log("-----------------------------------------\n");

  const runStep = async <T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<{ result: T; durationMs: number }> => {
    console.log(`⏳ En cours : ${label}...`);
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      return { result, durationMs };
    } catch (err) {
      console.error(`✗ Échec lors de : ${label}`);
      throw err;
    }
  };

  const report = (
    step: string,
    model: string,
    usage: Parameters<typeof costUsd>[2],
    durationMs: number,
    tier: "standard" | "batch" = "standard",
  ) => {
    const cost = costUsd(model, tier, usage, now);
    total += cost;
    const durSec = (durationMs / 1000).toFixed(1);
    console.log(
      `✓ ${step} (${model}) [${durSec}s] — ${JSON.stringify(usage)} — ${cost.toFixed(5)} $\n`,
    );
  };

  const { result: extracted, durationMs: extractDur } = await runStep(
    `[1/4] Extraction du cours (${e.GEMINI_MODEL_TEXT})`,
    () => llm.extract({ kind: "text", text: SOURCE }),
  );
  report("extraction", extracted.model, extracted.usage, extractDur);

  const section = extracted.data.sections[0];
  if (!section) throw new Error("Extraction sans section.");

  const { result: script, durationMs: rewriteDur } = await runStep(
    `[2/4] Réécriture en script chuchoté (${e.GEMINI_MODEL_TEXT})`,
    () =>
      llm.rewrite({
        section,
        ctx: { mode: "whisper", addressForm: "tu", isFirst: true, isLast: true },
      }),
  );
  report("réécriture", script.model, script.usage, rewriteDur);

  const { result: verdict, durationMs: verifyDur } = await runStep(
    `[3/4] Contrôle de fidélité (${e.GEMINI_MODEL_CHECK})`,
    () => llm.verify(section, script.data),
  );
  report(`contrôle (ok=${verdict.data.ok})`, verdict.model, verdict.usage, verifyDur);

  const voiceId = PREBUILT_VOICES[0]?.id ?? "Achernar";
  const text = renderGeminiChunkText([...VOICE_PREVIEW_SEGMENTS]);
  let ttsStep = 1;
  for (const model of [e.GEMINI_MODEL_TTS_LITE, e.GEMINI_MODEL_TTS]) {
    const isLite = model === e.GEMINI_MODEL_TTS_LITE;
    const labelQuality = isLite ? "Éco" : "Standard";
    const { result: speech, durationMs: ttsDur } = await runStep(
      `[4/4 - ${ttsStep++}/2] Synthèse TTS ${labelQuality} (${model})`,
      async () => {
        const res = await synthesizeSpeech({ model, text, voiceId, style: TTS_STYLE.whisper });
        await writeFile(`.data/smoke-${model}.wav`, res.wav).catch(() => undefined);
        return res;
      },
    );
    report(`TTS ${speech.sampleRate} Hz, ${speech.durationMs} ms`, model, speech.usage, ttsDur);
  }

  if (flags.has("--voice")) {
    const preset = VOICE_PRESETS[0];
    if (!preset) throw new Error("Aucun preset.");
    const { result: voice, durationMs: voiceDur } = await runStep(
      `[Option --voice] Création de voix designée (${e.GEMINI_MODEL_TTS})`,
      () => designVoice({ ...preset, label: "Smoke test", model: e.GEMINI_MODEL_TTS }),
    );
    console.log(
      `✓ voice design → ${voice.providerVoiceId} [${(voiceDur / 1000).toFixed(1)}s] (échantillon : ${voice.sampleWav?.length ?? 0} octets)`,
    );
    await runStep(`[Option --voice] Nettoyage de la voix test (${voice.providerVoiceId})`, () =>
      deleteVoice(voice.providerVoiceId),
    );
    console.log("✓ voix supprimée\n");
  }

  if (flags.has("--batch")) {
    const model = e.GEMINI_MODEL_TTS_LITE;
    const { result: batchSub } = await runStep(
      `[Option --batch] Soumission du job Batch TTS (${model})`,
      () =>
        submitSpeechBatch(
          model,
          [{ key: "smoke-1", model, text, voiceId, style: TTS_STYLE.whisper }],
          "murmure-smoke",
        ),
    );
    console.log(
      `✓ batch soumis : ${batchSub.jobId} — sondage toutes les 30 s (Ctrl+C pour abandonner)`,
    );
    let poll = 1;
    for (;;) {
      console.log(`⏳ Sondage batch #${poll}...`);
      const job = await getSpeechBatch(batchSub.jobId);
      if (job.state === "failed")
        throw new Error(`Batch en échec : ${job.error ?? "raison inconnue"}`);
      if (job.state === "done" && job.resultFile) {
        const stats = await readSpeechBatchResults(job.resultFile, async (audio) => {
          report(`batch TTS ${audio.durationMs} ms`, model, audio.usage, 0, "batch");
        });
        console.log(`✓ batch terminé : ${stats.succeeded} réussi(s), ${stats.failed} échec(s)\n`);
        break;
      }
      poll++;
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  console.log(
    `Coût estimé de ce test : ${total.toFixed(5)} $ (la console de facturation fait foi).`,
  );
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
