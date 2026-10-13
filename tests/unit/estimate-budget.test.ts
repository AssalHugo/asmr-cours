import { describe, expect, it } from "vitest";
import { checkBudget, expressAllowed } from "@/lib/budget";
import { estimateCourse, speechRate, type EstimateInput } from "@/lib/estimate";

const models = {
  text: "gemini-3.8-flash",
  check: "gemini-3.5-flash-lite",
  tts: "gemini-3.8-flash-tts",
  ttsLite: "gemini-3.8-flash-lite-tts",
};
const base: EstimateInput = {
  sourceChars: 50_000,
  sourceKind: "pdf",
  pages: 20,
  mode: "whisper",
  models,
  at: new Date("2026-10-13T00:00:00Z"),
};

describe("estimate", () => {
  it("donne la durée type de la spec : 50 000 caractères ≈ 69 min en chuchoté", () => {
    const est = estimateCourse(base);
    expect(est.durationSec / 60).toBeCloseTo(69.4, 1);
    expect(estimateCourse({ ...base, mode: "soft" }).durationSec / 60).toBeCloseTo(61.7, 1);
    expect(est.rateIsMeasured).toBe(false);
  });

  it("chiffre les 4 combinaisons, de la moins chère à la plus chère", () => {
    const { combos, textUsd } = estimateCourse(base);
    const tts = (k: keyof typeof combos) => combos[k].ttsUsd;
    // 4 167 s × 25 tokens × 9 $/M ≈ 0,94 $ en Express Standard.
    expect(tts("express-standard")).toBeGreaterThan(0.93);
    expect(tts("express-standard")).toBeLessThan(0.97);
    expect(tts("eco-standard")).toBeCloseTo(tts("express-standard") / 2, 6);
    expect(tts("eco-economy")).toBeLessThan(tts("eco-standard"));
    expect(tts("express-economy")).toBeLessThan(tts("express-standard"));
    expect(combos["eco-standard"].totalUsd).toBeCloseTo(tts("eco-standard") + textUsd, 10);
    expect(textUsd).toBeGreaterThan(0.05);
    expect(textUsd).toBeLessThan(0.5);
  });

  it("double après le 01/01/2027", () => {
    const now = estimateCourse(base).combos["express-standard"].ttsUsd;
    const later = estimateCourse({ ...base, at: new Date("2027-02-01T00:00:00Z") }).combos[
      "express-standard"
    ].ttsUsd;
    expect(later).toBeCloseTo(now * 2, 6);
  });

  it("utilise le débit mesuré à partir de 3 cours", () => {
    const measured = [
      { sourceChars: 10_000, durationMs: 1_000_000 },
      { sourceChars: 20_000, durationMs: 2_000_000 },
    ];
    expect(speechRate("whisper", measured)).toEqual({ rate: 12, measured: false });
    const three = speechRate("whisper", [
      ...measured,
      { sourceChars: 30_000, durationMs: 3_000_000 },
    ]);
    expect(three.measured).toBe(true);
    expect(three.rate).toBeCloseTo(10, 6);
  });

  it("coûte zéro en mode mock", () => {
    const est = estimateCourse({ ...base, mock: true });
    expect(est.combos["express-standard"].totalUsd).toBe(0);
    expect(est.durationSec).toBeGreaterThan(0);
  });
});

describe("garde-fou budget", () => {
  const input = {
    spentUsd: 2,
    estimateUsd: 1,
    budgetUsd: 10,
    tier: "eco" as const,
    confirmed: false,
  };

  it("laisse passer sous 80 %", () => {
    expect(checkBudget(input)).toMatchObject({ ok: true, warning: false, remainingUsd: 8 });
  });
  it("refuse au-delà du budget, même confirmé", () => {
    const res = checkBudget({ ...input, spentUsd: 9.5, confirmed: true });
    expect(res).toMatchObject({ ok: false, reason: "over_budget" });
    expect(res.ok ? "" : res.message).toContain("0,50 $");
  });
  it("demande une confirmation explicite au-delà de 80 %", () => {
    expect(checkBudget({ ...input, spentUsd: 7.5 })).toMatchObject({
      ok: false,
      reason: "needs_confirmation",
    });
    expect(checkBudget({ ...input, spentUsd: 7.5, confirmed: true })).toMatchObject({
      ok: true,
      warning: true,
    });
  });
  it("désactive Express au-delà de 80 %", () => {
    expect(
      checkBudget({ ...input, spentUsd: 7.5, tier: "express", confirmed: true }),
    ).toMatchObject({
      ok: false,
      reason: "express_disabled",
    });
    expect(expressAllowed(7.5, 1, 10)).toBe(false);
    expect(expressAllowed(2, 1, 10)).toBe(true);
  });
  it("refuse tout avec un budget nul", () => {
    expect(checkBudget({ ...input, spentUsd: 0, estimateUsd: 0.01, budgetUsd: 0 }).ok).toBe(false);
  });
});
