import { describe, expect, it } from "vitest";
import { buildChapters, buildTimeline, renderFfmetadata } from "@/lib/audio/chapters";
import { encodeVoiceArgs, masterArgs, masterFilter } from "@/lib/audio/master";
import { mixArgs, mixFilter } from "@/lib/audio/mix";
import { concatList, silenceArgs, trimSilenceArgs } from "@/lib/audio/silence";

describe("arguments FFmpeg", () => {
  it("construit la chaîne de mastering de la spec", () => {
    expect(masterFilter()).toBe(
      "highpass=f=70,deesser=i=0.4,acompressor=threshold=-24dB:ratio=2:attack=15:release=200,equalizer=f=160:t=q:w=1:g=1.5,loudnorm=I=-19:TP=-2:LRA=7,aresample=48000",
    );
    expect(masterArgs("in.wav", "out.wav")).toEqual([
      "-i",
      "in.wav",
      "-af",
      masterFilter(),
      "-ac",
      "1",
      "out.wav",
    ]);
  });

  it("encode la voix en AAC 96k faststart avec les chapitres", () => {
    expect(encodeVoiceArgs("m.wav", "c.ffmeta", "voice.m4a").join(" ")).toBe(
      "-i m.wav -f ffmetadata -i c.ffmeta -map 0:a -map_chapters 1 -c:a aac -b:a 96k -movflags +faststart voice.m4a",
    );
  });

  it("cale le fondu final du pré-mix 12 s avant la fin", () => {
    expect(mixFilter(-4, 600_000)).toBe(
      "[0:a]pan=stereo|c0=c0|c1=c0[v];[1:a]volume=-4.0dB,afade=t=in:d=8[bg];[v][bg]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=588.000:d=12[out]",
    );
    expect(mixFilter(0, 5000)).toContain("afade=t=out:st=0.000:d=12");
    const args = mixArgs({
      master: "m.wav",
      ambience: "a.flac",
      chaptersMeta: "c.ffmeta",
      output: "mix.m4a",
      ambienceGainDb: -4,
      durationMs: 600_000,
    });
    expect(args.slice(0, 9)).toEqual([
      "-i",
      "m.wav",
      "-stream_loop",
      "-1",
      "-i",
      "a.flac",
      "-f",
      "ffmetadata",
      "-i",
    ]);
    expect(args.join(" ")).toContain(
      "-map [out] -map_chapters 2 -c:a aac -b:a 128k -movflags +faststart mix.m4a",
    );
  });

  it("passe chaque valeur comme un argument distinct, jamais dans une chaîne shell", () => {
    const hostile = "a b; rm -rf $(x).wav";
    expect(trimSilenceArgs(hostile, "out.wav")).toContain(hostile);
    expect(silenceArgs(1234, "s.wav")).toEqual([
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "1.234",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "s.wav",
    ]);
    expect(concatList(["/tmp/a.wav", "/tmp/l'été.wav"])).toBe(
      "file '/tmp/a.wav'\nfile '/tmp/l'\\''été.wav'\n",
    );
  });
});

describe("chronologie", () => {
  const chunks = [
    { sectionId: "s1", caption: "Un.", durationMs: 1000, pauseAfterMs: 1500 },
    { sectionId: "s1", caption: "Deux.", durationMs: 2000, pauseAfterMs: 3000 },
    { sectionId: "s2", caption: "Trois.", durationMs: 500, pauseAfterMs: 0 },
  ];

  it("place chunks, sous-titres et sections à partir des durées mesurées", () => {
    const t = buildTimeline(chunks);
    expect(t.chunks).toEqual([
      { startMs: 0, durationMs: 1000 },
      { startMs: 2500, durationMs: 2000 },
      { startMs: 7500, durationMs: 500 },
    ]);
    expect(t.captions[1]).toEqual({ startMs: 2500, endMs: 4500, text: "Deux." });
    expect(t.sections).toEqual([
      { sectionId: "s1", startMs: 0, durationMs: 7500 },
      { sectionId: "s2", startMs: 7500, durationMs: 500 },
    ]);
    expect(t.totalMs).toBe(8000);
  });

  it("écrit les chapitres au format FFMETADATA1, caractères spéciaux échappés", () => {
    const t = buildTimeline(chunks);
    const chapters = buildChapters(
      t.sections,
      new Map([
        ["s1", "Intro = début; #1"],
        ["s2", "Fin"],
      ]),
    );
    expect(renderFfmetadata("Mon cours", chapters)).toBe(
      [
        ";FFMETADATA1",
        "title=Mon cours",
        "",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=0",
        "END=7500",
        "title=Intro \\= début\\; \\#1",
        "",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=7500",
        "END=8000",
        "title=Fin",
        "",
      ].join("\n"),
    );
  });
});
