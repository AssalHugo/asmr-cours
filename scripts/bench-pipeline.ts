/**
 * Mesure le pipeline (mode mock, vrai FFmpeg) sur une durée d'audio donnée, pour choisir
 * la machine Trigger.dev (§8.0). Usage :
 *   /usr/bin/time -v pnpm exec tsx --conditions=react-server scripts/bench-pipeline.ts 50000
 * L'argument est le nombre de caractères de source (50 000 ≈ 69 min en chuchoté).
 */
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, USER } from "../tests/helpers/pipeline";
import { generateCourse } from "@/trigger/steps/orchestrate";

const SENTENCES = [
  "La mémoire est la capacité à encoder, stocker et récupérer une information.",
  "L'encodage transforme une perception en trace mnésique.",
  "Le stockage maintient cette trace dans le temps.",
  "La récupération permet d'y accéder à nouveau, par rappel ou par reconnaissance.",
  "Chaque révision ralentit l'oubli, et la courbe devient moins abrupte après chaque rappel.",
];

function sourceText(chars: number): string {
  const paragraphs: string[] = [];
  let length = 0;
  for (let p = 0; length < chars; p++) {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `${SENTENCES[(p + i) % SENTENCES.length]} (${p}.${i})`,
    );
    const paragraph = sentences.join(" ").replace(/[()]/g, "");
    paragraphs.push(paragraph);
    length += paragraph.length + 2;
  }
  return paragraphs.join("\n\n").slice(0, chars);
}

async function peakTmpBytes(): Promise<number> {
  let total = 0;
  for (const name of await readdir(tmpdir())) {
    if (!name.startsWith("murmure-")) continue;
    const dir = join(tmpdir(), name);
    for (const file of await readdir(dir).catch(() => [])) {
      total += (await stat(join(dir, file)).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

async function main() {
  const chars = Number(process.argv[2] ?? 50_000);
  const h = await createHarness();
  const course = await h.addCourse({ tier: "express" }, { text: sourceText(chars) });

  let peakDisk = 0;
  const watcher = setInterval(
    () => void peakTmpBytes().then((b) => (peakDisk = Math.max(peakDisk, b))),
    500,
  );
  const marks: [string, number][] = [];
  const start = Date.now();
  const report = h.deps.report;
  h.deps.report = (p) => {
    if (marks.at(-1)?.[0] !== p.status) marks.push([p.status, Date.now() - start]);
    report?.(p);
  };

  await generateCourse(h.deps, { courseId: course.id, userId: USER, titleIsDefault: false });
  clearInterval(watcher);

  const done = h.repo.courses.get(course.id);
  const chunks = await h.repo.listChunks(course.id);
  console.log(
    JSON.stringify(
      {
        sourceChars: chars,
        audioMinutes: Number(((done?.duration_ms ?? 0) / 60_000).toFixed(1)),
        chunks: chunks.length,
        totalSeconds: Number(((Date.now() - start) / 1000).toFixed(1)),
        stepStartsMs: Object.fromEntries(marks),
        nodePeakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
        peakTmpDiskMb: Math.round(peakDisk / 1024 / 1024),
        renders: (await h.repo.listRenders(course.id)).map((r) => ({
          kind: r.kind,
          mb: Number(((r.bytes ?? 0) / 1024 / 1024).toFixed(1)),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
