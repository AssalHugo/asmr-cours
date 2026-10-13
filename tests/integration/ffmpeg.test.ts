import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ambiencePrepareArgs } from "@/lib/audio/ambience-prepare";
import { renderFfmetadata } from "@/lib/audio/chapters";
import { probe, runFfmpeg, runFfmpegVerbose } from "@/lib/audio/ffmpeg";
import { encodeVoiceArgs, masterArgs } from "@/lib/audio/master";
import { mixArgs, noiseBedArgs } from "@/lib/audio/mix";
import { concatArgs, concatList, silenceArgs, trimSilenceArgs } from "@/lib/audio/silence";
import { parseWav, pcm16ToWav, sineWav } from "@/lib/audio/wav";

/** Vrai FFmpeg sur une fixture de 10 s (docs/SPEC.md §13). */
describe("FFmpeg réel", () => {
  let dir = "";
  const file = (name: string) => join(dir, name);
  const chapters = [
    { title: "Début = intro; suite", startMs: 0, durationMs: 4000 },
    { title: "Fin", startMs: 4000, durationMs: 6000 },
  ];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "murmure-ffmpeg-"));
    await writeFile(file("voice_raw.wav"), sineWav(10_000, { gain: 0.2 }));
    await writeFile(file("chapters.ffmeta"), renderFfmetadata("Fixture", chapters));
    await runFfmpeg(masterArgs(file("voice_raw.wav"), file("voice_master.wav")));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("masterise à 48 kHz mono sans changer la durée, autour de −19 LUFS", async () => {
    const master = await probe(file("voice_master.wav"));
    expect(master).toMatchObject({ sampleRate: 48_000, channels: 1 });
    expect(Math.abs(master.durationMs - 10_000)).toBeLessThan(50);

    const { stderr } = await runFfmpegVerbose([
      "-i",
      file("voice_master.wav"),
      "-af",
      "ebur128",
      "-f",
      "null",
      "-",
    ]);
    const lufs = Number(
      /I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary")))?.[1],
    );
    expect(lufs).toBeGreaterThan(-21);
    expect(lufs).toBeLessThan(-17);
  });

  it("encode la voix en AAC avec ses chapitres", async () => {
    await runFfmpeg(
      encodeVoiceArgs(file("voice_master.wav"), file("chapters.ffmeta"), file("voice.m4a")),
    );
    const voice = await probe(file("voice.m4a"));
    expect(voice).toMatchObject({ codec: "aac", sampleRate: 48_000, channels: 1 });
    expect(Math.abs(voice.durationMs - 10_000)).toBeLessThan(150);
    expect(voice.chapters).toEqual([
      { title: "Début = intro; suite", startMs: 0, endMs: 4000 },
      { title: "Fin", startMs: 4000, endMs: 10_000 },
    ]);
  });

  it("mixe en stéréo avec une ambiance plus courte, bouclée sur toute la durée", async () => {
    await runFfmpeg(
      noiseBedArgs(file("ambience.flac"), { color: "pink", seconds: 3, codec: "flac" }),
    );
    await runFfmpeg(
      mixArgs({
        master: file("voice_master.wav"),
        ambience: file("ambience.flac"),
        chaptersMeta: file("chapters.ffmeta"),
        output: file("mix.m4a"),
        ambienceGainDb: -6,
        durationMs: 10_000,
      }),
    );
    const mix = await probe(file("mix.m4a"));
    expect(mix).toMatchObject({ codec: "aac", sampleRate: 48_000, channels: 2 });
    expect(Math.abs(mix.durationMs - 10_000)).toBeLessThan(150);
    expect(mix.chapters).toHaveLength(2);
  });

  it("retire les silences de bord sans rogner la parole, puis insère des pauses exactes", async () => {
    // 500 ms de silence, 1 s de son, 700 ms de silence.
    const tone = sineWav(1000).subarray(44);
    const padded = Buffer.concat([Buffer.alloc(24_000), tone, Buffer.alloc(33_600)]);
    await writeFile(file("padded.wav"), pcm16ToWav(padded, 24_000));
    await runFfmpeg(trimSilenceArgs(file("padded.wav"), file("trimmed.wav")));
    const trimmed = parseWav(await readFile(file("trimmed.wav")));
    expect(trimmed).toMatchObject({ sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
    // Le son est entier (1 000 ms), avec au plus la marge de 80 ms de chaque côté.
    expect(trimmed.durationMs).toBeGreaterThanOrEqual(990);
    expect(trimmed.durationMs).toBeLessThanOrEqual(1200);

    await runFfmpeg(silenceArgs(1500, file("silence.wav")));
    expect(parseWav(await readFile(file("silence.wav"))).durationMs).toBe(1500);

    await writeFile(
      file("list.txt"),
      concatList([file("trimmed.wav"), file("silence.wav"), file("trimmed.wav")]),
    );
    await runFfmpeg(concatArgs(file("list.txt"), file("joined.wav")));
    expect(parseWav(await readFile(file("joined.wav"))).durationMs).toBe(
      trimmed.durationMs * 2 + 1500,
    );
  });

  it("prépare une ambiance : boucle sans couture, −28 LUFS, FLAC et AAC", async () => {
    await runFfmpeg(noiseBedArgs(file("raw.flac"), { color: "brown", seconds: 20, codec: "flac" }));
    await runFfmpeg(
      ambiencePrepareArgs(file("raw.flac"), file("amb.flac"), {
        sourceSeconds: 20,
        target: "master",
      }),
    );
    await runFfmpeg(
      ambiencePrepareArgs(file("raw.flac"), file("amb.m4a"), { sourceSeconds: 20, target: "web" }),
    );
    expect(await probe(file("amb.flac"))).toMatchObject({
      codec: "flac",
      sampleRate: 48_000,
      channels: 2,
    });
    const web = await probe(file("amb.m4a"));
    expect(web).toMatchObject({ codec: "aac", channels: 2 });
    // 20 s moins les 3 s de recouvrement fin → début.
    expect(Math.abs(web.durationMs - 17_000)).toBeLessThan(150);

    const { stderr } = await runFfmpegVerbose([
      "-i",
      file("amb.flac"),
      "-af",
      "ebur128",
      "-f",
      "null",
      "-",
    ]);
    const lufs = Number(
      /I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary")))?.[1],
    );
    expect(lufs).toBeGreaterThan(-30);
    expect(lufs).toBeLessThan(-26);
  });
});
