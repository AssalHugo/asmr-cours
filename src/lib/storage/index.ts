import "server-only";
import { join } from "node:path";
import { env } from "@/lib/env";
import { createR2Storage } from "@/lib/r2";
import { createLocalStorage } from "./local";
import type { ObjectStorage } from "./types";

export const LOCAL_STORAGE_ROOT = join(process.cwd(), ".data", "storage");

let cached: ObjectStorage | undefined;

export function storage(): ObjectStorage {
  cached ??=
    env().STORAGE_MODE === "local" ? createLocalStorage(LOCAL_STORAGE_ROOT) : createR2Storage();
  return cached;
}

export * from "./types";
export { keys } from "./keys";
