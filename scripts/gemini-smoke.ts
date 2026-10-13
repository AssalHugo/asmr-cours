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
  const report = (
    step: string,
    model: string,
    usage: Parameters<typeof costUsd>[2],
    tier: "standard" | "batch" = "standard",
  ) => {
    const cost = costUsd(model, tier, usage, now);
    total += cost;
    console.log(`✓ ${step} (${model}) — ${JSON.stringify(usage)} — ${cost.toFixed(5)} $`);
  };

  const extracted = await llm.extract({ kind: "text", text: SOURCE });
  report("extraction", extracted.model, extracted.usage);
  const section = extracted.data.sections[0];
  if (!section) throw new Error("Extraction sans section.");

  const script = await llm.rewrite({
    section,
    ctx: { mode: "whisper", addressForm: "tu", isFirst: true, isLast: true },
  });
  report("réécriture", script.model, script.usage);

  const verdict = await llm.verify(section, script.data);
  report(`contrôle (ok=${verdict.data.ok})`, verdict.model, verdict.usage);

  const voiceId = PREBUILT_VOICES[0]?.id ?? "Achernar";
  const text = renderGeminiChunkText([...VOICE_PREVIEW_SEGMENTS]);
  for (const model of [e.GEMINI_MODEL_TTS_LITE, e.GEMINI_MODEL_TTS]) {
    const speech = await synthesizeSpeech({ model, text, voiceId, style: TTS_STYLE.whisper });
    await writeFile(`.data/smoke-${model}.wav`, speech.wav).catch(() => undefined);
    report(`TTS ${speech.sampleRate} Hz, ${speech.durationMs} ms`, model, speech.usage);
  }

  if (flags.has("--voice")) {
    const preset = VOICE_PRESETS[0];
    if (!preset) throw new Error("Aucun preset.");
    const voice = await designVoice({ ...preset, label: "Smoke test", model: e.GEMINI_MODEL_TTS });
    console.log(
      `✓ voice design → ${voice.providerVoiceId} (échantillon : ${voice.sampleWav?.length ?? 0} octets)`,
    );
    await deleteVoice(voice.providerVoiceId);
    console.log("✓ voix supprimée");
  }

  if (flags.has("--batch")) {
    const model = e.GEMINI_MODEL_TTS_LITE;
    const { jobId } = await submitSpeechBatch(
      model,
      [{ key: "smoke-1", model, text, voiceId, style: TTS_STYLE.whisper }],
      "murmure-smoke",
    );
    console.log(`✓ batch soumis : ${jobId} — sondage toutes les 30 s (Ctrl+C pour abandonner)`);
    for (;;) {
      const job = await getSpeechBatch(jobId);
      if (job.state === "failed")
        throw new Error(`Batch en échec : ${job.error ?? "raison inconnue"}`);
      if (job.state === "done" && job.resultFile) {
        const stats = await readSpeechBatchResults(job.resultFile, async (audio) => {
          report(`batch TTS ${audio.durationMs} ms`, model, audio.usage, "batch");
        });
        console.log(`✓ batch terminé : ${stats.succeeded} réussi(s), ${stats.failed} échec(s)`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  console.log(
    `\nCoût estimé de ce test : ${total.toFixed(5)} $ (la console de facturation fait foi).`,
  );
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
