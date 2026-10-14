import { describe, expect, it } from "vitest";
import { keys } from "@/lib/storage/keys";
import {
  CreateMessageInput,
  dueMessage,
  messageExtension,
  parseClock,
  pickRecorderMime,
  PrepareMessageInput,
} from "@/lib/voice-messages";

const ID = "4b6f7a7e-2a7c-4f43-9f55-0d7d3a1c9b10";

describe("messages vocaux", () => {
  it("joue d'abord le message du lancement, puis le premier moment atteint", () => {
    const launch = { id: "a", atMs: null, durationMs: 1000 };
    const early = { id: "b", atMs: 10_000, durationMs: 1000 };
    const late = { id: "c", atMs: 60_000, durationMs: 1000 };
    expect(dueMessage([late, early, launch], 0)).toBe(launch);
    expect(dueMessage([late, early], 5_000)).toBeUndefined();
    expect(dueMessage([late, early], 10_000)).toBe(early);
    // Reprise loin après les deux moments : chacun passe quand même, dans l'ordre.
    expect(dueMessage([late, early], 90_000)).toBe(early);
  });

  it("lit un moment écrit à la main", () => {
    expect(parseClock("12:30")).toBe(750_000);
    expect(parseClock(" 0:05 ")).toBe(5_000);
    expect(parseClock("1:02:07")).toBe(3_727_000);
    expect(parseClock("12")).toBeNull();
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("a:10")).toBeNull();
  });

  it("préfère l'AAC en MP4 à l'enregistrement, et n'accepte que l'audio", () => {
    expect(pickRecorderMime((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime(() => true)).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickRecorderMime(() => false)).toBeUndefined();
    expect(messageExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(messageExtension("audio/MP4")).toBe("m4a");
    expect(messageExtension("video/mp4")).toBeUndefined();
  });

  it("valide les entrées des actions", () => {
    expect(
      PrepareMessageInput.safeParse({ courseId: ID, mime: "audio/mp4", bytes: 10 }).success,
    ).toBe(true);
    expect(
      PrepareMessageInput.safeParse({ courseId: ID, mime: "text/html", bytes: 10 }).success,
    ).toBe(false);
    expect(
      PrepareMessageInput.safeParse({ courseId: ID, mime: "audio/mp4", bytes: 50 * 1024 * 1024 })
        .success,
    ).toBe(false);
    const base = { courseId: ID, messageId: ID, mime: "audio/webm", durationMs: 4000 };
    expect(CreateMessageInput.safeParse({ ...base, atMs: null }).success).toBe(true);
    expect(CreateMessageInput.safeParse({ ...base, atMs: -1 }).success).toBe(false);
    expect(
      CreateMessageInput.safeParse({ ...base, durationMs: 10 * 60_000, atMs: 0 }).success,
    ).toBe(false);
  });

  it("range l'audio sous le préfixe du cours", () => {
    expect(keys.voiceMessage(ID, ID, "webm")).toBe(`courses/${ID}/messages/${ID}.webm`);
    expect(() => keys.voiceMessage(ID, "../x", "webm")).toThrow();
  });
});
