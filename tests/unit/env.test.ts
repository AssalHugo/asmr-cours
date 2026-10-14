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
    expect(env.ADMIN_EMAILS).toEqual([]);
    expect(parseServerEnv({ ADMIN_EMAILS: " A@x.fr " }).ADMIN_EMAILS).toEqual(["a@x.fr"]);
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("rejette une valeur invalide", () => {
    expect(() => parseServerEnv({ AI_MODE: "prod" })).toThrow(/AI_MODE/);
    expect(() => parseServerEnv({ MAX_UPLOAD_MB: "-1" })).toThrow();
  });

  it("interdit les modes sans clés en production", () => {
    expect(() => parseServerEnv({ APP_ENV: "prod", STORAGE_MODE: "local" })).toThrow(
      /STORAGE_MODE=local/,
    );
    expect(() => parseServerEnv({ APP_ENV: "prod", AI_MODE: "mock" })).toThrow(/AI_MODE=mock/);
    expect(() => parseServerEnv({ APP_ENV: "prod", JOBS_MODE: "inline" })).toThrow(/JOBS_MODE/);
    expect(parseServerEnv({ APP_ENV: "prod" }).STORAGE_MODE).toBe("r2");
    expect(parseServerEnv({ APP_ENV: "dev", STORAGE_MODE: "local" }).STORAGE_MODE).toBe("local");
  });

  it("lit le plafond global, absent par défaut", () => {
    expect(parseServerEnv({}).GLOBAL_MONTHLY_BUDGET_USD).toBeUndefined();
    expect(parseServerEnv({ GLOBAL_MONTHLY_BUDGET_USD: "" }).GLOBAL_MONTHLY_BUDGET_USD).toBe(
      undefined,
    );
    expect(parseServerEnv({ GLOBAL_MONTHLY_BUDGET_USD: "40" }).GLOBAL_MONTHLY_BUDGET_USD).toBe(40);
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
