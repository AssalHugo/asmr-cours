import { describe, expect, it } from "vitest";
import { parseWav, pcm16ToWav, sineWav } from "@/lib/audio/wav";
import { mapLimit, retryAfterMs, withRetry } from "@/lib/retry";

describe("wav", () => {
  it("écrit et relit un WAV 24 kHz mono 16 bits", () => {
    const info = parseWav(sineWav(1500));
    expect(info).toMatchObject({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      durationMs: 1500,
    });
    expect(parseWav(pcm16ToWav(Buffer.alloc(48_000), 24_000)).durationMs).toBe(1000);
  });
  it("rejette ce qui n'est pas un WAV", () => {
    expect(() => parseWav(Buffer.from("pas un wav du tout"))).toThrow(/WAV invalide/);
  });
});

describe("withRetry", () => {
  const noSleep = { sleep: async () => {}, random: () => 0.5 };

  it("réessaie les erreurs passagères, 3 essais au plus", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      if (++calls < 3) throw Object.assign(new Error("surcharge"), { status: 503 });
      return "ok";
    }, noSleep);
    expect(result).toBe("ok");
    expect(calls).toBe(3);

    calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error("limite"), { status: 429 });
      }, noSleep),
    ).rejects.toThrow("limite");
    expect(calls).toBe(3);
  });

  it("ne réessaie pas une erreur définitive", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error("requête invalide"), { status: 400 });
      }, noSleep),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("respecte Retry-After sur un 429", async () => {
    const waits: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        if (++calls === 1) {
          throw Object.assign(new Error("limite"), {
            status: 429,
            headers: new Headers({ "retry-after": "7" }),
          });
        }
        return true;
      },
      { sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(waits).toEqual([7000]);
    expect(retryAfterMs({ headers: { "retry-after": "2" } })).toBe(2000);
  });

  it("borne la concurrence de mapLimit et garde l'ordre", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(2);
  });
});
