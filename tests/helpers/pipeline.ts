import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiProviders } from "@/lib/ai";
import { createMockLlm } from "@/lib/llm/mock";
import type { LlmProvider } from "@/lib/llm/provider";
import type { RunProgress } from "@/lib/pipeline/status";
import { withWorkdir } from "@/lib/pipeline/workdir";
import { keys, uploadFileName } from "@/lib/storage/keys";
import { createLocalStorage } from "@/lib/storage/local";
import type { ObjectStorage } from "@/lib/storage/types";
import { createMockTts, createMockVoiceDesigner } from "@/lib/tts/mock";
import type { TtsProvider } from "@/lib/tts/provider";
import type { PipelineDeps } from "@/trigger/steps/context";
import { makeCourse, makeProfile, makeVoice, MemoryRepo } from "./memory-repo";
import type { CourseRow } from "@/lib/pipeline/repo";

export const USER = "11111111-1111-4111-8111-111111111111";

export type Calls = {
  extract: number;
  rewrite: number;
  verify: number;
  reexplain: number;
  tts: number;
  waits: number;
};

export type Harness = {
  repo: MemoryRepo;
  storage: ObjectStorage;
  deps: PipelineDeps;
  calls: Calls;
  reports: RunProgress[];
  voiceId: string;
  addCourse(
    patch?: Partial<CourseRow>,
    source?: { text: string } | { pdf: string },
  ): Promise<CourseRow>;
};

export type HarnessOptions = {
  llm?: Partial<LlmProvider>;
  tts?: Partial<TtsProvider>;
  models?: AiProviders["models"];
  budgetUsd?: number;
  /** Lève une erreur au n-ième appel de synthèse (interruption simulée). */
  failTtsAt?: number;
};

/** Pipeline complet en mémoire : dépôt factice, stockage sur disque temporaire, IA mock comptée. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "murmure-test-"));
  const storage = createLocalStorage(root);
  const repo = new MemoryRepo();
  const calls: Calls = {
    extract: 0,
    rewrite: 0,
    verify: 0,
    reexplain: 0,
    tts: 0,
    waits: 0,
  };
  const reports: RunProgress[] = [];

  const baseLlm = { ...createMockLlm(), ...options.llm };
  const llm: LlmProvider = {
    id: "mock",
    extract: (input) => (calls.extract++, baseLlm.extract(input)),
    rewrite: (input) => (calls.rewrite++, baseLlm.rewrite(input)),
    verify: (section, script) => (calls.verify++, baseLlm.verify(section, script)),
    reexplain: (input) => (calls.reexplain++, baseLlm.reexplain(input)),
  };
  const baseTts = { ...createMockTts(), ...options.tts };
  const tts: TtsProvider = {
    ...baseTts,
    synthesize: async (req) => {
      calls.tts++;
      if (options.failTtsAt !== undefined && calls.tts === options.failTtsAt) {
        throw new Error("Coupure simulée pendant la synthèse");
      }
      return baseTts.synthesize(req);
    },
  };

  repo.profiles.set(USER, makeProfile(USER, options.budgetUsd ?? 10));
  const voice = makeVoice(USER);
  repo.voices.set(voice.id, voice);

  const deps: PipelineDeps = {
    repo,
    storage,
    ai: {
      mock: true,
      llm,
      tts,
      voices: createMockVoiceDesigner(),
      models: options.models ?? { text: "mock", check: "mock", tts: "mock", ttsLite: "mock" },
    },
    appEnv: "dev",
    limits: { ttsConcurrency: 4, maxSourceChars: 150_000 },
    now: () => new Date("2026-10-13T12:00:00Z"),
    wait: async () => void calls.waits++,
    report: (p) => void reports.push(p),
    workdir: withWorkdir,
    batchPollSeconds: 180,
    batchTimeoutMs: 24 * 60 * 60 * 1000,
  };

  return {
    repo,
    storage,
    deps,
    calls,
    reports,
    voiceId: voice.id,
    async addCourse(patch = {}, source = { text: SHORT_TEXT }) {
      const course = makeCourse(USER, voice.id, patch);
      if ("text" in source) {
        const key = keys.upload(USER, course.id, "source.txt");
        await storage.put(key, Buffer.from(source.text), "text/plain");
        Object.assign(course, { source_kind: "text", source_keys: [key] });
      } else {
        const key = keys.upload(USER, course.id, uploadFileName(0, course.id, "pdf"));
        await storage.put(key, await readFile(source.pdf), "application/pdf");
        Object.assign(course, { source_kind: "pdf", source_keys: [key] });
      }
      repo.courses.set(course.id, course);
      return course;
    },
  };
}

/** Deux paragraphes courts : un pipeline complet en une ou deux secondes. */
export const SHORT_TEXT = [
  "La photosynthèse transforme l'énergie lumineuse en énergie chimique. Elle a lieu dans les chloroplastes. Elle consomme de l'eau et du dioxyde de carbone. Elle produit du glucose et du dioxygène.",
  "La respiration cellulaire fait l'inverse. Elle dégrade le glucose pour libérer de l'énergie. Elle se déroule dans les mitochondries. Elle rejette du dioxyde de carbone et de l'eau.",
].join("\n\n");
