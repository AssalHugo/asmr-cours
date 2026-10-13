import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probe } from "@/lib/audio/ffmpeg";
import { Caption, Chapter } from "@/lib/pipeline/schemas";
import { STATUS_ORDER } from "@/lib/pipeline/status";
import { keys } from "@/lib/storage/keys";
import { createMockTts } from "@/lib/tts/mock";
import {
  failCourse,
  generateCourse,
  redoChunk,
  regenerateSection,
  remixCourse,
  voiceSample,
} from "@/trigger/steps/orchestrate";
import { PipelineError } from "@/trigger/steps/context";
import { createHarness, USER } from "../helpers/pipeline";

const PDF = fileURLToPath(new URL("../fixtures/cours-3-pages.pdf", import.meta.url));
const payload = (courseId: string) => ({ courseId, userId: USER, titleIsDefault: true });

let scratch = "";
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "murmure-probe-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

describe("pipeline complet en mode mock", () => {
  it("produit les rendus d'un PDF de 3 pages, avec chapitres et sous-titres cohérents", async () => {
    const h = await createHarness();
    const course = await h.addCourse({ ambience: "rain", ambience_gain_db: -4 }, { pdf: PDF });

    await generateCourse(h.deps, payload(course.id));

    const done = h.repo.courses.get(course.id)!;
    expect(done.status).toBe("ready");
    expect(done.progress).toBe(100);
    expect(done.title).toBe("La mémoire : encodage, stockage, récupération");
    expect(done.source_chars).toBeGreaterThan(4000);
    expect(done.actual_cost_usd).toBe(0);
    expect(done.error).toBeNull();

    // Rendus publiés : voix seule et pré-mix de l'ambiance choisie.
    const renders = await h.repo.listRenders(course.id);
    expect(renders.map((r) => `${r.kind}:${r.ambience}`).sort()).toEqual([
      "mix:rain",
      "voice:null",
    ]);
    for (const r of renders) {
      expect((await h.storage.head(r.key))?.bytes).toBe(r.bytes);
      expect(r.duration_ms).toBe(done.duration_ms);
    }

    // Chapitres : un par section, contigus, couvrant toute la piste.
    const chapters = Chapter.array().parse(
      JSON.parse((await h.storage.get(keys.chapters(course.id))).toString()),
    );
    const sections = await h.repo.listSections(course.id);
    expect(chapters.map((c) => c.title)).toEqual(sections.map((s) => s.title));
    expect(chapters).toHaveLength(3);
    expect(chapters[0]?.startMs).toBe(0);
    chapters.slice(1).forEach((c, i) => {
      expect(c.startMs).toBe((chapters[i]?.startMs ?? 0) + (chapters[i]?.durationMs ?? 0));
    });
    const total = chapters.reduce((sum, c) => sum + c.durationMs, 0);
    expect(Math.abs(total - (done.duration_ms ?? 0))).toBeLessThan(200);
    expect(sections.every((s) => s.verified && s.start_ms !== null && s.duration_ms !== null)).toBe(
      true,
    );

    // Sous-titres : un par chunk, ordonnés, sans chevauchement, dans la durée de la piste.
    const captions = Caption.array().parse(
      JSON.parse((await h.storage.get(keys.captions(course.id))).toString()),
    );
    const chunks = await h.repo.listChunks(course.id);
    expect(captions).toHaveLength(chunks.length);
    captions.forEach((c, i) => {
      expect(c.endMs).toBeGreaterThan(c.startMs);
      expect(c.startMs).toBe(chunks[i]?.start_ms);
      expect(c.text).toBe(chunks[i]?.caption);
      expect(c.text).not.toMatch(/[<>]/);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(captions[i - 1]?.endMs ?? 0);
    });
    expect(captions.at(-1)?.endMs).toBeLessThanOrEqual(total);

    // Fichiers audio réels : AAC 48 kHz, chapitres embarqués, voix et mix en stéréo.
    const voicePath = join(scratch, "voice.m4a");
    const mixPath = join(scratch, "mix.m4a");
    await h.storage.downloadFile(keys.voice(course.id), voicePath);
    await h.storage.downloadFile(keys.mix(course.id, "rain"), mixPath);
    const voice = await probe(voicePath);
    const mix = await probe(mixPath);
    expect(voice).toMatchObject({ codec: "aac", sampleRate: 48_000, channels: 2 });
    expect(mix).toMatchObject({ codec: "aac", sampleRate: 48_000, channels: 2 });
    expect(voice.chapters.map((c) => c.title)).toEqual(chapters.map((c) => c.title));
    expect(mix.chapters).toHaveLength(3);
    expect(Math.abs(voice.durationMs - total)).toBeLessThan(300);
    expect(Math.abs(mix.durationMs - total)).toBeLessThan(300);

    // Suivi : statuts dans l'ordre du pipeline, avancement croissant, tout journalisé.
    const order = h.reports.map((r) => STATUS_ORDER.indexOf(r.status));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h.reports.at(-1)).toMatchObject({ status: "ready", progress: 100 });
    const progress = h.reports.map((r) => r.progress);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(new Set(h.repo.usage.map((u) => u.step))).toEqual(
      new Set(["extract", "rewrite", "verify", "tts"]),
    );
    expect(h.calls).toMatchObject({ extract: 1, rewrite: 3, verify: 3 });
    expect(h.calls.tts).toBe(new Set(chunks.map((c) => c.hash)).size);
    // Le cours le plus long de la suite : trois sections, mastering en deux passes.
  }, 120_000);

  it("reprend après une interruption sans refaire ce qui est déjà fait", async () => {
    const h = await createHarness({ failTtsAt: 3 });
    const course = await h.addCourse();

    await expect(generateCourse(h.deps, payload(course.id))).rejects.toThrow("Coupure simulée");
    await failCourse(h.deps, course.id, USER, new Error("Coupure simulée"));
    expect(h.repo.courses.get(course.id)).toMatchObject({ status: "failed" });
    expect(h.repo.courses.get(course.id)?.error).toContain("Tu peux la reprendre");

    const total = new Set((await h.repo.listChunks(course.id)).map((c) => c.hash)).size;
    const doneBefore = (await h.repo.listChunks(course.id)).filter(
      (c) => c.status === "done",
    ).length;
    expect(doneBefore).toBeGreaterThan(0);
    expect(doneBefore).toBeLessThan(total);
    const before = { ...h.calls };

    await generateCourse(h.deps, payload(course.id));

    expect(h.repo.courses.get(course.id)).toMatchObject({ status: "ready", error: null });
    // Ni extraction, ni réécriture, ni contrôle rejoués ; seuls les chunks manquants sont synthétisés.
    expect(h.calls.extract).toBe(before.extract);
    expect(h.calls.rewrite).toBe(before.rewrite);
    expect(h.calls.verify).toBe(before.verify);
    expect(h.calls.tts - before.tts).toBe(total - doneBefore);
  });

  it("passe par le Batch en mode Éco et attend entre deux sondages", async () => {
    const h = await createHarness();
    const course = await h.addCourse({ tier: "eco" });

    await generateCourse(h.deps, payload(course.id));

    const done = h.repo.courses.get(course.id)!;
    expect(done).toMatchObject({ status: "ready", batch_job_id: null, batch_submitted_at: null });
    expect(h.reports.some((r) => r.status === "waiting_batch")).toBe(true);
    expect(h.calls.waits).toBe(1);
    expect(h.calls.tts).toBe(0);
    const tts = h.repo.usage.filter((u) => u.step === "tts");
    expect(tts.length).toBeGreaterThan(0);
    expect(tts.every((u) => u.tier === "batch")).toBe(true);
    // En Éco, le chuchoté voyage dans le texte : le Batch n'a pas de style par tour.
    const chunks = await h.repo.listChunks(course.id);
    expect(chunks.every((c) => c.style === "" && c.text.startsWith("<whispers> "))).toBe(true);
    expect(chunks.every((c) => !c.caption.includes("<"))).toBe(true);
  });

  it("retombe sur l'API standard si le Batch est indisponible", async () => {
    const h = await createHarness({
      tts: {
        submitBatch: async () => {
          throw new Error("Batch non disponible en free tier");
        },
      },
    });
    const course = await h.addCourse({ tier: "eco" });
    await generateCourse(h.deps, payload(course.id));
    expect(h.repo.courses.get(course.id)?.status).toBe("ready");
    expect(h.calls.tts).toBeGreaterThan(0);
    expect(h.repo.usage.filter((u) => u.step === "tts").every((u) => u.tier === "standard")).toBe(
      true,
    );
  });

  it("garde le rendu Éco quand un chunk retombe sur l'API standard", async () => {
    const requests: { text: string; style: string }[] = [];
    const mock = createMockTts();
    const h = await createHarness({
      tts: {
        submitBatch: async () => {
          throw new Error("Batch non disponible en free tier");
        },
        synthesize: async (req) => {
          requests.push({ text: req.text, style: req.style });
          return mock.synthesize(req);
        },
      },
    });
    const course = await h.addCourse({ tier: "eco" });
    await generateCourse(h.deps, payload(course.id));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.style === "" && r.text.startsWith("<whispers> "))).toBe(true);
  });

  it("refait une fois un passage à la durée aberrante, et journalise la prise rejetée", async () => {
    const mock = createMockTts();
    let truncated = false;
    const h = await createHarness({
      tts: {
        synthesize: async (req) => {
          const result = await mock.synthesize(req);
          if (truncated || req.text.length < 60) return result;
          truncated = true;
          return { ...result, durationMs: 200 };
        },
      },
    });
    const course = await h.addCourse();
    await generateCourse(h.deps, payload(course.id));

    const hashes = new Set((await h.repo.listChunks(course.id)).map((c) => c.hash));
    expect(truncated).toBe(true);
    expect(h.calls.tts).toBe(hashes.size + 1);
    expect(h.repo.usage.filter((u) => u.step === "tts")).toHaveLength(hashes.size + 1);
    expect(h.repo.courses.get(course.id)?.status).toBe("ready");
  });

  it("refait un seul passage sans toucher au script ni aux autres", async () => {
    const h = await createHarness();
    const course = await h.addCourse();
    await generateCourse(h.deps, payload(course.id));
    const before = await h.repo.listChunks(course.id);
    const target = before[1]!;
    const calls = { ...h.calls };

    await redoChunk(h.deps, { courseId: course.id, userId: USER, chunkId: target.id });

    const after = await h.repo.listChunks(course.id);
    expect(h.calls.tts - calls.tts).toBe(1);
    expect(h.calls.rewrite).toBe(calls.rewrite);
    expect(after.map((c) => c.text)).toEqual(before.map((c) => c.text));
    expect(after[1]?.hash).not.toBe(target.hash);
    expect(after.filter((c, i) => c.hash !== before[i]?.hash)).toHaveLength(1);
    expect(h.repo.courses.get(course.id)).toMatchObject({ status: "ready" });
    // La prise d'origine reste en cache : un autre cours peut la partager.
    expect(await h.storage.head(keys.ttsCache(target.hash))).not.toBeNull();

    // Deuxième prise : la première, propre à ce cours, est retirée du cache.
    const firstTake = after[1]!;
    await redoChunk(h.deps, { courseId: course.id, userId: USER, chunkId: firstTake.id });
    const again = await h.repo.listChunks(course.id);
    expect(again[1]?.hash).not.toBe(firstTake.hash);
    expect(await h.storage.head(keys.ttsCache(firstTake.hash))).toBeNull();
    expect(await h.storage.head(keys.ttsCache(again[1]!.hash))).not.toBeNull();

    // Une reprise complète garde la prise choisie.
    const ttsBefore = h.calls.tts;
    await generateCourse(h.deps, payload(course.id));
    expect(h.calls.tts).toBe(ttsBefore);
    expect((await h.repo.listChunks(course.id))[1]?.hash).toBe(again[1]?.hash);
  });

  it("relance la réécriture deux fois au plus, puis continue avec une alerte", async () => {
    const report = { ok: false, missingFacts: ["Un fait"], alteredFacts: [], inventedClaims: [] };
    const h = await createHarness({
      llm: {
        verify: async () => ({
          data: report,
          model: "mock",
          usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, audioSeconds: 0 },
        }),
      },
    });
    const course = await h.addCourse();

    await generateCourse(h.deps, payload(course.id));

    const sections = await h.repo.listSections(course.id);
    expect(h.repo.courses.get(course.id)?.status).toBe("ready");
    expect(sections.every((s) => s.verified === false)).toBe(true);
    expect(sections[0]?.verify_report).toMatchObject({ ok: false, missingFacts: ["Un fait"] });
    // Par section : 1 réécriture initiale + 2 relances, et 3 contrôles.
    expect(h.calls.rewrite).toBe(sections.length * 3);
    expect(h.calls.verify).toBe(sections.length * 3);
  });

  it("ne repaie que les chunks modifiés quand on régénère une section", async () => {
    let variant = "";
    const base = (await createHarness()).deps.ai.llm;
    const h = await createHarness({
      llm: {
        rewrite: async (input) => {
          const res = await base.rewrite(input);
          const first = res.data.segments[0];
          if (first && variant) first.text = `${variant} ${first.text}`;
          return res;
        },
      },
    });
    const course = await h.addCourse();
    await generateCourse(h.deps, payload(course.id));
    const sections = await h.repo.listSections(course.id);
    const total = new Set((await h.repo.listChunks(course.id)).map((c) => c.hash)).size;
    const voiceBefore = (await h.repo.listRenders(course.id)).find((r) => r.kind === "voice");

    // Même script : tout vient du cache, aucun appel TTS.
    let before = h.calls.tts;
    await regenerateSection(h.deps, {
      courseId: course.id,
      userId: USER,
      sectionId: sections[0]!.id,
    });
    expect(h.calls.tts - before).toBe(0);

    // Script modifié sur une section : seuls ses chunks changés sont synthétisés.
    variant = "Reprenons.";
    before = h.calls.tts;
    const extractBefore = h.calls.extract;
    await regenerateSection(h.deps, {
      courseId: course.id,
      userId: USER,
      sectionId: sections[0]!.id,
    });
    const paid = h.calls.tts - before;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(total);
    expect(h.calls.extract).toBe(extractBefore);
    expect(h.repo.courses.get(course.id)?.status).toBe("ready");
    const voiceAfter = (await h.repo.listRenders(course.id)).find((r) => r.kind === "voice");
    expect(voiceAfter?.duration_ms).not.toBe(voiceBefore?.duration_ms);
  });

  it("change l'ambiance du pré-mix sans aucun appel IA", async () => {
    const h = await createHarness();
    const course = await h.addCourse({ ambience: "rain" });
    await generateCourse(h.deps, payload(course.id));
    const before = { ...h.calls };
    const usageBefore = h.repo.usage.length;

    await remixCourse(h.deps, {
      courseId: course.id,
      userId: USER,
      ambience: "fireplace",
      ambienceGainDb: -5,
    });

    expect(h.calls).toEqual(before);
    expect(h.repo.usage).toHaveLength(usageBefore);
    expect(h.repo.courses.get(course.id)).toMatchObject({ status: "ready", ambience: "fireplace" });
    expect(await h.storage.head(keys.mix(course.id, "fireplace"))).not.toBeNull();
    expect(await h.storage.head(keys.mix(course.id, "rain"))).toBeNull();
    const renders = await h.repo.listRenders(course.id);
    expect(renders.map((r) => `${r.kind}:${r.ambience}`).sort()).toEqual([
      "mix:fireplace",
      "voice:null",
    ]);
  });

  it("arrête le cours avant la synthèse si le budget ne suffit pas", async () => {
    const h = await createHarness({
      budgetUsd: 0.0001,
      models: {
        text: "gemini-3.8-flash",
        check: "gemini-3.5-flash-lite",
        tts: "gemini-3.8-flash-tts",
        ttsLite: "gemini-3.8-flash-lite-tts",
      },
    });
    const course = await h.addCourse();

    const run = generateCourse(h.deps, payload(course.id));
    await expect(run).rejects.toThrow(PipelineError);
    const message = await failCourse(h.deps, course.id, USER, await run.catch((e: unknown) => e));
    expect(message).toContain("budget du mois");
    expect(h.calls.tts).toBe(0);
    expect(h.calls.rewrite).toBe(0);
    expect(h.repo.courses.get(course.id)).toMatchObject({ status: "failed" });
  });

  it("rejoue le contrôle du budget quand on reprend un cours arrêté pour dépassement", async () => {
    const h = await createHarness({
      budgetUsd: 0.0001,
      models: {
        text: "gemini-3.8-flash",
        check: "gemini-3.5-flash-lite",
        tts: "gemini-3.8-flash-tts",
        ttsLite: "gemini-3.8-flash-lite-tts",
      },
    });
    const course = await h.addCourse();
    await expect(generateCourse(h.deps, payload(course.id))).rejects.toThrow(PipelineError);

    // « Reprendre » : l'extraction est déjà faite, le budget n'en est pas moins dépassé.
    await expect(generateCourse(h.deps, payload(course.id))).rejects.toThrow(/budget du mois/);
    expect(h.calls.extract).toBe(1);
    expect(h.calls.rewrite).toBe(0);
    expect(h.calls.tts).toBe(0);
  });

  it("arrête le cours quand le plafond global est atteint, même si le budget personnel suffit", async () => {
    const h = await createHarness({
      models: {
        text: "gemini-3.8-flash",
        check: "gemini-3.5-flash-lite",
        tts: "gemini-3.8-flash-tts",
        ttsLite: "gemini-3.8-flash-lite-tts",
      },
    });
    h.deps.limits.globalBudgetUsd = 0.0001;
    const course = await h.addCourse();
    await expect(generateCourse(h.deps, payload(course.id))).rejects.toThrow(/budget global/);
    expect(h.calls.rewrite).toBe(0);
  });

  it("ne facture qu'une fois un résultat de Batch livré deux fois", async () => {
    const mock = createMockTts();
    const h = await createHarness({
      tts: {
        pollBatch: (jobId, onResult) =>
          mock.pollBatch!(jobId, async (result) => {
            await onResult(result);
            await onResult(result);
          }),
      },
    });
    const course = await h.addCourse({ tier: "eco" });
    await generateCourse(h.deps, payload(course.id));

    const hashes = new Set((await h.repo.listChunks(course.id)).map((c) => c.hash));
    expect(h.repo.usage.filter((u) => u.step === "tts")).toHaveLength(hashes.size);
  });

  it("garde le cours prêt, avec son ambiance, quand un changement d'ambiance échoue", async () => {
    const h = await createHarness();
    const course = await h.addCourse({ ambience: "rain" });
    await generateCourse(h.deps, payload(course.id));

    const remix = remixCourse(h.deps, {
      courseId: course.id,
      userId: USER,
      ambience: "inconnue",
      ambienceGainDb: -6,
    });
    await expect(remix).rejects.toThrow(PipelineError);
    await failCourse(h.deps, course.id, USER, await remix.catch((e: unknown) => e), {
      keepReady: true,
    });
    const after = h.repo.courses.get(course.id)!;
    expect(after).toMatchObject({ status: "ready", ambience: "rain" });
    expect(after.error).toContain("n'est pas encore installée");
  });

  it("garde l'ancien script si la régénération d'une section échoue", async () => {
    let broken = false;
    const base = (await createHarness()).deps.ai.llm;
    const h = await createHarness({
      llm: {
        rewrite: async (input) => {
          if (broken) throw new Error("Panne simulée de la réécriture");
          return base.rewrite(input);
        },
      },
    });
    const course = await h.addCourse();
    await generateCourse(h.deps, payload(course.id));
    const [section] = await h.repo.listSections(course.id);

    broken = true;
    await expect(
      regenerateSection(h.deps, { courseId: course.id, userId: USER, sectionId: section!.id }),
    ).rejects.toThrow("Panne simulée");
    expect((await h.repo.listSections(course.id))[0]?.script).toEqual(section!.script);
  });

  it("met en cache l'échantillon d'une voix par mode", async () => {
    const h = await createHarness();
    const first = await voiceSample(h.deps, { voiceId: h.voiceId, userId: USER, mode: "whisper" });
    const again = await voiceSample(h.deps, { voiceId: h.voiceId, userId: USER, mode: "whisper" });
    const soft = await voiceSample(h.deps, { voiceId: h.voiceId, userId: USER, mode: "soft" });
    expect(first).toEqual({ key: keys.voiceSample(h.voiceId, "whisper"), cached: false });
    expect(again.cached).toBe(true);
    expect(soft.cached).toBe(false);
    expect(h.calls.tts).toBe(2);
    expect(h.repo.voices.get(h.voiceId)?.last_used_at).not.toBeNull();
  });
});
