import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Binaires FFmpeg : `FFMPEG_PATH`/`FFPROBE_PATH` (posés par l'extension Trigger.dev),
 * sinon les paquets `ffmpeg-static`/`ffprobe-static` (dev et tests), sinon le PATH.
 */
function resolveBinary(envName: "FFMPEG_PATH" | "FFPROBE_PATH"): string {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const require = createRequire(import.meta.url);
  try {
    if (envName === "FFMPEG_PATH") {
      const path: unknown = require("ffmpeg-static");
      if (typeof path === "string") return path;
    } else {
      const mod: unknown = require("ffprobe-static");
      if (
        typeof mod === "object" &&
        mod !== null &&
        "path" in mod &&
        typeof mod.path === "string"
      ) {
        return mod.path;
      }
    }
  } catch {
    // Paquet absent (image de production) : on retombe sur le PATH.
  }
  return envName === "FFMPEG_PATH" ? "ffmpeg" : "ffprobe";
}

let ffmpegBin: string | undefined;
let ffprobeBin: string | undefined;
export const ffmpegPath = () => (ffmpegBin ??= resolveBinary("FFMPEG_PATH"));
export const ffprobePath = () => (ffprobeBin ??= resolveBinary("FFPROBE_PATH"));

export class FfmpegError extends Error {
  constructor(
    readonly binary: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(
      `${binary} a échoué (code ${exitCode ?? "?"}) : ${stderrTail.trim().split("\n").at(-1) ?? ""}`,
    );
    this.name = "FfmpegError";
  }
}

/** Lance un binaire avec un tableau d'arguments — jamais de chaîne shell. */
function run(
  binary: string,
  args: readonly string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(binary, code, stderr.slice(-2000)));
    });
  });
}

export const BASE_ARGS = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"] as const;

export function runFfmpeg(args: readonly string[], cwd?: string) {
  return run(ffmpegPath(), [...BASE_ARGS, ...args], cwd);
}

/** Comme `runFfmpeg`, mais garde la sortie des filtres d'analyse (ebur128…). */
export function runFfmpegVerbose(args: readonly string[], cwd?: string) {
  return run(ffmpegPath(), ["-hide_banner", "-nostdin", "-y", ...args], cwd);
}

export type ProbeResult = {
  durationMs: number;
  sampleRate: number;
  channels: number;
  codec: string;
  chapters: { title: string; startMs: number; endMs: number }[];
};

export async function probe(path: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobePath(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-show_chapters",
    path,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
      duration?: string;
    }[];
    chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[];
  };
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  return {
    durationMs: Math.round((Number(data.format?.duration ?? audio?.duration) || 0) * 1000),
    sampleRate: Number(audio?.sample_rate ?? 0),
    channels: audio?.channels ?? 0,
    codec: audio?.codec_name ?? "",
    chapters: (data.chapters ?? []).map((c) => ({
      title: c.tags?.title ?? "",
      startMs: Math.round(Number(c.start_time ?? 0) * 1000),
      endMs: Math.round(Number(c.end_time ?? 0) * 1000),
    })),
  };
}

export async function probeDurationMs(path: string): Promise<number> {
  return (await probe(path)).durationMs;
}
