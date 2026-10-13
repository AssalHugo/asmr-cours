import { describe, expect, it } from "vitest";
import { parseWav, sineWav } from "@/lib/audio/wav";
import { batchRequestLine, parseBatchResultLine } from "@/lib/gemini/batch";
import { toWav } from "@/lib/gemini/tts";
import { audioUsage, textUsage } from "@/lib/gemini/usage";
import { createMockLlm } from "@/lib/llm/mock";
import { ExtractedCourse, Script, scriptProblems } from "@/lib/pipeline/schemas";
import { createMockTts } from "@/lib/tts/mock";
import type { TtsResult } from "@/lib/tts/provider";

describe("LLM mock", () => {
  const llm = createMockLlm();

  it("renvoie le cours fixture pour un PDF, à coût nul", async () => {
    const res = await llm.extract({ kind: "pdf", files: [] });
    expect(res.model).toBe("mock");
    expect(res.usage.inputTokens).toBe(0);
    expect(ExtractedCourse.parse(res.data).sections).toHaveLength(3);
  });

  it("découpe un texte collé par paragraphes", async () => {
    const res = await llm.extract({ kind: "text", text: "Premier bloc de cours.\n\nSecond bloc." });
    expect(res.data.sections.map((s) => s.content)).toEqual([
      "Premier bloc de cours.",
      "Second bloc.",
    ]);
  });

  it("réécrit en un script valide et fidèle en longueur", async () => {
    const { data: course } = await llm.extract({ kind: "pdf", files: [] });
    for (const section of course.sections) {
      const { data } = await llm.rewrite({
        section,
        ctx: { mode: "whisper", addressForm: "tu", isFirst: true, isLast: false },
      });
      expect(Script.safeParse(data).success).toBe(true);
      expect(scriptProblems(data, section.content.length)).toEqual([]);
      expect(data.segments.some((s) => s.pauseAfterMs >= 1000)).toBe(true);
    }
  });
});

describe("TTS mock", () => {
  const tts = createMockTts();
  const req = {
    key: "k",
    model: "mock",
    voiceId: "v",
    style: "whispering",
    text: "<breath> " + "a".repeat(120),
  };

  it("produit un WAV 24 kHz dont la durée suit le texte, balises exclues", async () => {
    const res = await tts.synthesize(req);
    expect(parseWav(res.wav)).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
      durationMs: 10_000,
    });
    expect(res.durationMs).toBe(10_000);
    expect(res.usage.audioSeconds).toBe(0);
  });

  it("fait attendre le batch un sondage, puis livre chaque résultat", async () => {
    const { jobId } = await tts.submitBatch!([req, { ...req, key: "k2" }], "test");
    const got: TtsResult[] = [];
    const collect = async (r: TtsResult) => void got.push(r);
    expect(await tts.pollBatch!(jobId, collect)).toEqual({ state: "running" });
    expect(got).toHaveLength(0);
    expect(await tts.pollBatch!(jobId, collect)).toEqual({ state: "done", failed: 0 });
    expect(got.map((r) => r.key)).toEqual(["k", "k2"]);
  });
});

describe("format Gemini", () => {
  it("enveloppe le PCM brut dans un WAV et laisse un WAV intact", () => {
    const wav = sineWav(500);
    expect(toWav(wav, "audio/wav")).toBe(wav);
    const fromPcm = toWav(wav.subarray(44), "audio/L16;codec=pcm;rate=24000");
    expect(parseWav(fromPcm)).toMatchObject({ sampleRate: 24_000, durationMs: 500 });
    expect(() => toWav(Buffer.from("ID3"), "audio/mp3")).toThrow(/inattendu/);
  });

  it("écrit une ligne de batch avec la voix, et le texte tel qu'il a été balisé", () => {
    const item = { key: "c1", model: "m", text: "<whispers> Bonjour.", style: "" };
    const custom = JSON.parse(batchRequestLine({ ...item, voiceId: "voice_abc123" }));
    expect(custom.key).toBe("c1");
    expect(custom.request.contents[0].parts[0].text).toBe("<whispers> Bonjour.");
    expect(custom.request.generation_config.speech_config.voice_config).toEqual({
      voice: "voice_abc123",
    });
    const prebuilt = JSON.parse(batchRequestLine({ ...item, voiceId: "Achernar" }));
    expect(prebuilt.request.generation_config.speech_config.voice_config).toEqual({
      prebuilt_voice_config: { voice_name: "Achernar" },
    });
    expect(JSON.stringify(custom)).not.toContain('"speech_metadata"');
  });

  it("décode une ligne de résultat batch, et ignore un échec", () => {
    const pcm = sineWav(1000).subarray(44).toString("base64");
    const ok = parseBatchResultLine(
      JSON.stringify({
        key: "c1",
        response: {
          candidates: [
            {
              content: { parts: [{ inlineData: { data: pcm, mimeType: "audio/L16;rate=24000" } }] },
            },
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 25 },
        },
      }),
    );
    expect(ok).toMatchObject({
      key: "c1",
      durationMs: 1000,
      usage: { inputTokens: 12, audioSeconds: 1 },
    });
    expect(parseBatchResultLine(JSON.stringify({ key: "c2", error: { code: 500 } }))).toBeNull();
  });

  it("lit l'usage des interactions", () => {
    const usage = { total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 5 };
    expect(textUsage(usage)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      thinkingTokens: 5,
      audioSeconds: 0,
    });
    expect(audioUsage(usage, 3)).toMatchObject({
      inputTokens: 10,
      thinkingTokens: 0,
      audioSeconds: 3,
    });
    expect(textUsage(undefined).inputTokens).toBe(0);
  });
});
