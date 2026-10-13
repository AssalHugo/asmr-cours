import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { LOCAL_STORAGE_ROOT } from "@/lib/storage";
import { localContentType, localPath } from "@/lib/storage/local";

type Context = { params: Promise<{ key: string[] }> };

/** Remplace R2 en dev/E2E (`STORAGE_MODE=local`). Inexistant sinon. */
async function resolveRequest(context: Context) {
  if (env().STORAGE_MODE !== "local") return { error: new NextResponse(null, { status: 404 }) };
  const user = await getUser();
  if (!user) return { error: new NextResponse(null, { status: 401 }) };
  const key = (await context.params).key.join("/");
  try {
    return { user, key, path: localPath(LOCAL_STORAGE_ROOT, key) };
  } catch {
    return { error: new NextResponse(null, { status: 400 }) };
  }
}

export async function PUT(request: Request, context: Context) {
  const resolved = await resolveRequest(context);
  if ("error" in resolved) return resolved.error;
  if (!resolved.key.startsWith(`uploads/${resolved.user.id}/`)) {
    return new NextResponse(null, { status: 403 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > env().MAX_UPLOAD_MB * 1024 * 1024) {
    return new NextResponse(null, { status: 413 });
  }
  await mkdir(dirname(resolved.path), { recursive: true });
  await writeFile(resolved.path, body);
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request, context: Context) {
  const resolved = await resolveRequest(context);
  if ("error" in resolved) return resolved.error;
  if (
    resolved.key.startsWith("uploads/") &&
    !resolved.key.startsWith(`uploads/${resolved.user.id}/`)
  ) {
    return new NextResponse(null, { status: 403 });
  }
  const info = await stat(/* turbopackIgnore: true */ resolved.path).catch(() => null);
  if (!info?.isFile()) return new NextResponse(null, { status: 404 });

  const headers = new Headers({
    "Content-Type": localContentType(resolved.key),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      headers.set("Content-Range", `bytes */${info.size}`);
      return new NextResponse(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(
      createReadStream(/* turbopackIgnore: true */ resolved.path, { start, end }),
    );
    return new NextResponse(stream as ReadableStream<Uint8Array>, { status: 206, headers });
  }
  headers.set("Content-Length", String(info.size));
  const stream = Readable.toWeb(createReadStream(/* turbopackIgnore: true */ resolved.path));
  return new NextResponse(stream as ReadableStream<Uint8Array>, { status: 200, headers });
}
