import { describe, expect, it } from "vitest";
import { costUsd, priceIncreaseAhead, rateFor, UnknownModelPricingError } from "@/lib/pricing";

const in2026 = new Date("2026-12-31T23:59:59Z");
const in2027 = new Date("2027-01-01T00:00:00Z");

describe("pricing", () => {
  it("reprend le tableau §3.2 pour 2026", () => {
    expect(rateFor("gemini-3.8-flash", "standard", in2026)).toEqual({ input: 0.75, output: 3.75 });
    expect(rateFor("gemini-3.8-flash", "batch", in2026)).toEqual({ input: 0.375, output: 1.875 });
    expect(rateFor("gemini-3.8-flash-tts", "standard", in2026)).toEqual({ input: 0.5, output: 9 });
    expect(rateFor("gemini-3.8-flash-tts", "batch", in2026)).toEqual({ input: 0.25, output: 4.5 });
    expect(rateFor("gemini-3.8-flash-lite-tts", "batch", in2026)).toEqual({
      input: 0.25,
      output: 3,
    });
  });

  it("double les tarifs au 01/01/2027, sauf Flash-Lite texte", () => {
    expect(rateFor("gemini-3.8-flash", "standard", in2027)).toEqual({ input: 1.5, output: 7.5 });
    expect(rateFor("gemini-3.8-flash-tts", "batch", in2027)).toEqual({ input: 0.5, output: 9 });
    expect(rateFor("gemini-3.8-flash-lite-tts", "standard", in2027)).toEqual({
      input: 1,
      output: 12,
    });
    expect(rateFor("gemini-3.5-flash-lite", "standard", in2027)).toEqual({
      input: 0.3,
      output: 2.5,
    });
    expect(priceIncreaseAhead(in2026)).toBe(true);
    expect(priceIncreaseAhead(in2027)).toBe(false);
  });

  it("compte l'audio à 25 tokens par seconde", () => {
    // 1 h d'audio = 90 000 tokens ; 9 $/M → 0,81 $ ; la page tarifs annonce 0,00225 $ / 10 s.
    const hour = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, audioSeconds: 3600 };
    expect(costUsd("gemini-3.8-flash-tts", "standard", hour, in2026)).toBeCloseTo(0.81, 10);
    expect(costUsd("gemini-3.8-flash-tts", "batch", hour, in2026)).toBeCloseTo(0.405, 10);
    expect(
      costUsd("gemini-3.8-flash-tts", "standard", { ...hour, audioSeconds: 10 }, in2026),
    ).toBeCloseTo(0.00225, 10);
    expect(costUsd("gemini-3.8-flash-tts", "standard", hour, in2027)).toBeCloseTo(1.62, 10);
  });

  it("facture le thinking comme de la sortie", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 400_000,
      thinkingTokens: 600_000,
      audioSeconds: 0,
    };
    expect(costUsd("gemini-3.8-flash", "standard", usage, in2026)).toBeCloseTo(0.75 + 3.75, 10);
  });

  it("refuse un modèle sans tarif plutôt que de compter zéro", () => {
    expect(() => rateFor("gemini-9-ultra", "standard", in2026)).toThrow(UnknownModelPricingError);
    expect(
      costUsd(
        "mock",
        "standard",
        { inputTokens: 5, outputTokens: 5, thinkingTokens: 0, audioSeconds: 9 },
        in2026,
      ),
    ).toBe(0);
  });
});
