/**
 * Dessine les icônes de l'app (le disque sable et son halo, sur fond nuit) sans dépendance :
 * pnpm exec tsx scripts/make-icons.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const NIGHT = [0x14, 0x13, 0x2b] as const;
const SAND = [0xe8, 0xc9, 0x9b] as const;
const LAVENDER = [0xb9, 0xa8, 0xe8] as const;

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a: number, b: number, t: number) =>
  Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));

/** `scale` : part du côté occupée par le disque (plus petite pour l'icône « maskable »). */
function icon(size: number, scale: number): Buffer {
  const rows = Buffer.alloc((size * 3 + 1) * size);
  const center = (size - 1) / 2;
  const radius = (size * scale) / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center);
      const disc = Math.min(1, Math.max(0, radius - d + 0.5));
      const halo = Math.max(0, 1 - (d - radius) / (radius * 0.9)) ** 2 * 0.38;
      for (let c = 0; c < 3; c++) {
        const background = mix(NIGHT[c] ?? 0, LAVENDER[c] ?? 0, d > radius ? halo : 0);
        rows[row + 1 + x * 3 + c] = mix(background, SAND[c] ?? 0, disc);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  await mkdir("public/icons", { recursive: true });
  await writeFile("public/icons/icon-192.png", icon(192, 0.5));
  await writeFile("public/icons/icon-512.png", icon(512, 0.5));
  await writeFile("public/icons/icon-maskable-512.png", icon(512, 0.36));
  await writeFile("public/icons/apple-touch-icon.png", icon(180, 0.5));
  await writeFile("src/app/icon.png", icon(64, 0.56));
  console.log("Icônes écrites dans public/icons/");
}

void main();
