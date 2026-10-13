import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "@/lib/allowlist";

describe("isAllowedEmail", () => {
  const allowed = ["a@x.fr", "b@y.fr"];
  it("accepte une adresse listée, sans tenir compte de la casse", () => {
    expect(isAllowedEmail("A@X.fr ", allowed)).toBe(true);
  });
  it("refuse une adresse absente, vide ou une liste vide", () => {
    expect(isAllowedEmail("c@z.fr", allowed)).toBe(false);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("a@x.fr", [])).toBe(false);
  });
});
