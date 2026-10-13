import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAmbience, SYNTHETIC_AMBIENCE_ID } from "@/lib/ambiences";
import { buildChapters, buildTimeline, renderFfmetadata } from "@/lib/audio/chapters";
import { probeDurationMs, runFfmpeg } from "@/lib/audio/ffmpeg";
import { encodeVoiceArgs, masterArgs } from "@/lib/audio/master";
import { synthesizeAmbience } from "@/lib/audio/ambience-synth";
import { mixArgs } from "@/lib/audio/mix";
import { concatArgs, concatList, silenceArgs, trimSilenceArgs } from "@/lib/audio/silence";
import { parseWav } from "@/lib/audio/wav";
import { mapLimit } from "@/lib/retry";
import { keys } from "@/lib/storage/keys";
import { PipelineError, setStatus, type Ctx } from "./context";

/**
 * Fichier maître d'une ambiance. Le bruit rose est synthétisé par FFmpeg (et, en mode
 * mock, toutes les ambiances ont une doublure synthétique) ; les autres doivent avoir
 * été préparées et envoyées par `pnpm ambience:prepare` puis `pnpm ambience:upload`.
 */
export async function ensureAmbienceMaster(ctx: Ctx, id: string, dir: string): Promise<string> {
  const { storage, ai } = ctx.deps;
  const ambience = getAmbience(id);
  if (!ambience) throw new PipelineError(`Ambiance inconnue : ${id}.`);

  const path = join(dir, `ambience-${id}.flac`);
  if (await storage.head(keys.ambienceMaster(id))) {
    await storage.downloadFile(keys.ambienceMaster(id), path);
    return path;
  }
  if (id !== SYNTHETIC_AMBIENCE_ID && !ai.mock) {
    throw new PipelineError(
      `L'ambiance « ${ambience.label} » n'est pas encore installée. Choisis « Bruit rose », ou installe-la (docs/SETUP.md, étape Ambiances).`,
    );
  }
  await synthesizeAmbience(storage, id);
  await storage.downloadFile(keys.ambienceMaster(id), path);
  return path;
}

/**
 * §8.6 à §8.8 — Assemblage, mastering, pré-mix et publication. Aucun appel IA : tout part
 * des chunks du cache, ce qui rend l'étape rejouable (reprise, changement d'ambiance).
 */
export async function assembleAndPublish(ctx: Ctx): Promise<void> {
  const { repo, storage, workdir } = ctx.deps;
  const courseId = ctx.course.id;
  const chunks = await repo.listChunks(courseId);
  if (chunks.length === 0 || chunks.some((c) => c.status !== "done")) {
    throw new PipelineError("Tous les passages n'ont pas encore été enregistrés.");
  }
  const sections = await repo.listSections(courseId);

  await setStatus(ctx, "assembling");
  await workdir(async (dir) => {
    // Chunks : téléchargement puis retrait des silences de bord, une fois par hash.
    const hashes = [...new Set(chunks.map((c) => c.hash))];
    const durations = new Map<string, number>();
    await mapLimit(hashes, 4, async (hash) => {
      const raw = join(dir, `raw-${hash}.wav`);
      const trimmed = join(dir, `chunk-${hash}.wav`);
      await storage.downloadFile(keys.ttsCache(hash), raw);
      await runFfmpeg(trimSilenceArgs(raw, trimmed));
      durations.set(hash, parseWav(await readFile(trimmed)).durationMs);
    });

    // Silences de durée exacte, mis en cache par durée.
    const pauses = [...new Set(chunks.map((c) => c.pause_after_ms).filter((ms) => ms > 0))];
    await mapLimit(pauses, 4, (ms) => runFfmpeg(silenceArgs(ms, join(dir, `silence-${ms}.wav`))));

    const files = chunks.flatMap((c) => [
      join(dir, `chunk-${c.hash}.wav`),
      ...(c.pause_after_ms > 0 ? [join(dir, `silence-${c.pause_after_ms}.wav`)] : []),
    ]);
    const list = join(dir, "concat.txt");
    const voiceRaw = join(dir, "voice_raw.wav");
    await writeFile(list, concatList(files));
    await runFfmpeg(concatArgs(list, voiceRaw));

    // Chronologie à partir des durées mesurées.
    const timeline = buildTimeline(
      chunks.map((c) => ({
        sectionId: c.section_id,
        caption: c.caption,
        durationMs: durations.get(c.hash) ?? 0,
        pauseAfterMs: c.pause_after_ms,
      })),
    );
    await mapLimit(chunks, 8, (chunk, index) =>
      repo.updateChunk(chunk.id, {
        start_ms: timeline.chunks[index]?.startMs ?? 0,
        duration_ms: timeline.chunks[index]?.durationMs ?? 0,
      }),
    );
    await Promise.all(
      timeline.sections.map((s) =>
        repo.updateSection(s.sectionId, { start_ms: s.startMs, duration_ms: s.durationMs }),
      ),
    );
    const chapters = buildChapters(
      timeline.sections,
      new Map(sections.map((s) => [s.id, s.title])),
    );
    const meta = join(dir, "chapters.ffmeta");
    await writeFile(meta, renderFfmetadata(ctx.course.title, chapters));
    await setStatus(ctx, "assembling", 1);

    // Mastering, voix seule, puis pré-mix avec l'ambiance du cours.
    await setStatus(ctx, "mastering");
    const master = join(dir, "voice_master.wav");
    await runFfmpeg(masterArgs(voiceRaw, master));
    const durationMs = await probeDurationMs(master);

    const voice = join(dir, "voice.m4a");
    await runFfmpeg(encodeVoiceArgs(master, meta, voice));
    await setStatus(ctx, "mastering", 0.5);

    const ambienceId = ctx.course.ambience;
    const mix = join(dir, "mix.m4a");
    await runFfmpeg(
      mixArgs({
        master,
        ambience: await ensureAmbienceMaster(ctx, ambienceId, dir),
        chaptersMeta: meta,
        output: mix,
        ambienceGainDb: ctx.course.ambience_gain_db,
        durationMs,
      }),
    );

    // Publication.
    await storage.uploadFile(voice, keys.voice(courseId), "audio/mp4");
    await storage.uploadFile(mix, keys.mix(courseId, ambienceId), "audio/mp4");
    await storage.put(
      keys.chapters(courseId),
      Buffer.from(JSON.stringify(chapters)),
      "application/json",
    );
    await storage.put(
      keys.captions(courseId),
      Buffer.from(JSON.stringify(timeline.captions)),
      "application/json",
    );

    await repo.saveRender({
      course_id: courseId,
      kind: "voice",
      ambience: null,
      key: keys.voice(courseId),
      duration_ms: durationMs,
      bytes: (await stat(voice)).size,
    });
    await repo.saveRender({
      course_id: courseId,
      kind: "mix",
      ambience: ambienceId,
      key: keys.mix(courseId, ambienceId),
      duration_ms: durationMs,
      bytes: (await stat(mix)).size,
    });
    const stale = await repo.deleteRenders(courseId, [
      { kind: "voice", ambience: null },
      { kind: "mix", ambience: ambienceId },
    ]);
    await Promise.all(stale.map((r) => storage.delete(r.key)));

    await setStatus(ctx, "ready", 1, {
      duration_ms: durationMs,
      actual_cost_usd: Number((await repo.courseCost(courseId)).toFixed(4)),
      error: null,
    });
  });
}
