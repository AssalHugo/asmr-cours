import { beforeAll, describe, expect, it, vi } from "vitest";

describe("URLs présignées R2", () => {
  beforeAll(() => {
    vi.stubEnv("R2_ACCOUNT_ID", "acc123");
    vi.stubEnv("R2_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-example");
    vi.stubEnv("R2_BUCKET", "murmure-test");
  });

  it("signe type et taille du PUT, sans checksum que le navigateur ne saurait fournir", async () => {
    const { createR2Storage } = await import("@/lib/r2");
    const put = await createR2Storage().presignPut("uploads/u/c/000-x.pdf", {
      contentType: "application/pdf",
      bytes: 1234,
      expiresIn: 900,
    });
    const url = new URL(put.url);
    expect(url.host).toBe("murmure-test.acc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/uploads/u/c/000-x.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect([...url.searchParams.keys()].join(",")).not.toMatch(/checksum/i);
    expect(put.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("signe un GET de 6 h", async () => {
    const { createR2Storage } = await import("@/lib/r2");
    const { PRESIGN_GET_SECONDS } = await import("@/lib/storage/types");
    const url = new URL(
      await createR2Storage().presignGet("courses/c/voice.m4a", { expiresIn: PRESIGN_GET_SECONDS }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("21600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});
