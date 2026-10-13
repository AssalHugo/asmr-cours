import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keys, uploadFileName } from "@/lib/storage/keys";
import { createLocalStorage, localPath } from "@/lib/storage/local";
import { checkUploadRequest } from "@/lib/uploads";

const U = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";

describe("clés de stockage", () => {
  it("suit le plan du bucket", () => {
    expect(keys.upload(U, C, uploadFileName(2, C, "jpg"))).toBe(`uploads/${U}/${C}/002-${C}.jpg`);
    expect(keys.voice(C)).toBe(`courses/${C}/voice.m4a`);
    expect(keys.mix(C, "rain")).toBe(`courses/${C}/mix-rain.m4a`);
    expect(keys.chapters(C)).toBe(`courses/${C}/chapters.json`);
    expect(keys.ambienceWeb("pink-noise")).toBe("ambience/web/pink-noise.m4a");
    expect(keys.voiceSample(C, "whisper")).toBe(`voices/${C}/sample-whisper.wav`);
    expect(keys.ttsCache("a".repeat(64))).toBe(`tts-cache/${"a".repeat(64)}.wav`);
  });

  it("refuse tout identifiant qui ne soit pas un UUID ou un nom simple", () => {
    expect(() => keys.voice("../etc")).toThrow();
    expect(() => keys.mix(C, "../x")).toThrow();
    expect(() => keys.ttsCache("abc")).toThrow();
    expect(() => uploadFileName(0, C, "j/pg")).toThrow();
  });
});

describe("contrôle des uploads", () => {
  it("accepte un PDF dans la limite", () => {
    const res = checkUploadRequest(
      { kind: "pdf", files: [{ type: "application/pdf", size: 1024 }] },
      50,
    );
    expect(res).toEqual({ ok: true, extensions: ["pdf"] });
  });
  it("refuse un mauvais type, un fichier trop lourd ou plusieurs PDF", () => {
    const pdf = { type: "application/pdf", size: 10 };
    expect(checkUploadRequest({ kind: "pdf", files: [{ ...pdf, type: "text/html" }] }, 50).ok).toBe(
      false,
    );
    expect(
      checkUploadRequest({ kind: "pdf", files: [{ ...pdf, size: 51 * 1024 * 1024 }] }, 50).ok,
    ).toBe(false);
    expect(checkUploadRequest({ kind: "pdf", files: [pdf, pdf] }, 50).ok).toBe(false);
    expect(checkUploadRequest({ kind: "images", files: [pdf] }, 50).ok).toBe(false);
  });
  it("garde l'ordre des images", () => {
    const res = checkUploadRequest(
      {
        kind: "images",
        files: [
          { type: "image/HEIC", size: 5 },
          { type: "image/png", size: 5 },
        ],
      },
      50,
    );
    expect(res).toEqual({ ok: true, extensions: ["heic", "png"] });
  });
});

describe("stockage local", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "murmure-storage-"));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("écrit, lit, mesure et supprime par préfixe", async () => {
    const s = createLocalStorage(root);
    await s.put(keys.chapters(C), Buffer.from("[]"), "application/json");
    await s.put(keys.captions(C), Buffer.from("[1]"), "application/json");
    expect((await s.get(keys.chapters(C))).toString()).toBe("[]");
    expect(await s.head(keys.captions(C))).toEqual({ bytes: 3, contentType: "application/json" });
    expect(await s.head("absent.wav")).toBeNull();
    expect(await s.presignGet(keys.voice(C), { expiresIn: 60 })).toBe(
      `/api/dev-storage/courses/${C}/voice.m4a`,
    );
    await s.deletePrefix(keys.coursePrefix(C));
    expect(await s.head(keys.chapters(C))).toBeNull();
  });

  it("ne sort jamais de sa racine", () => {
    expect(() => localPath(root, "../../etc/passwd")).toThrow();
  });
});
