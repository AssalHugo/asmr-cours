import { describe, expect, it } from "vitest";
import { MissingEnvError, parseServerEnv, requireKeys } from "@/lib/env.schema";

describe("env", () => {
  it("applique les défauts de la spec", () => {
    const env = parseServerEnv({});
    expect(env.AI_MODE).toBe("live");
    expect(env.GEMINI_MODEL_TEXT).toBe("gemini-3.8-flash");
    expect(env.MONTHLY_BUDGET_USD).toBe(10);
    expect(env.MAX_SOURCE_CHARS).toBe(150_000);
    expect(env.ALLOWED_EMAILS).toEqual([]);
  });

  it("normalise l'allowlist et traite les chaînes vides comme absentes", () => {
    const env = parseServerEnv({ ALLOWED_EMAILS: " A@x.fr, b@y.fr ,", GEMINI_API_KEY: "" });
    expect(env.ALLOWED_EMAILS).toEqual(["a@x.fr", "b@y.fr"]);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("rejette une valeur invalide", () => {
    expect(() => parseServerEnv({ AI_MODE: "prod" })).toThrow(/AI_MODE/);
    expect(() => parseServerEnv({ MAX_UPLOAD_MB: "-1" })).toThrow();
  });

  it("signale les clés manquantes d'un service", () => {
    const env = parseServerEnv({ R2_ACCOUNT_ID: "abc" });
    expect(() => requireKeys(env, "R2", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID"] as const)).toThrow(
      MissingEnvError,
    );
    expect(requireKeys(env, "R2", ["R2_ACCOUNT_ID", "R2_BUCKET"] as const)).toEqual({
      R2_ACCOUNT_ID: "abc",
      R2_BUCKET: "murmure-audio",
    });
  });
});
