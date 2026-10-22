import { join } from "node:path";
import { comboKey, estimateCourse } from "@/lib/estimate";
import type { ExtractInput } from "@/lib/llm/provider";
import { normalizeSections, sampleSection } from "@/lib/pipeline/sections";
import { billed, patchCourse, PipelineError, recordUsage, setStatus, type Ctx } from "./context";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

async function loadSource(ctx: Ctx, dir: string): Promise<ExtractInput> {
  const { storage } = ctx.deps;
  const { source_kind: kind, source_keys: sourceKeys } = ctx.course;
  if (sourceKeys.length === 0) throw new PipelineError("Ce cours n'a plus de fichier source.");

  if (kind === "text") {
    const key = sourceKeys[0];
    if (!key) throw new PipelineError("Ce cours n'a plus de texte source.");
    return { kind: "text", text: (await storage.get(key)).toString("utf8") };
  }
  if (kind !== "pdf" && kind !== "images") throw new PipelineError("Type de source inconnu.");

  const files = await Promise.all(
    sourceKeys.map(async (key, index) => {
      const extension = key.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType) throw new PipelineError("Un fichier source a un format non pris en charge.");
      const info = await storage.head(key);
      if (!info)
        throw new PipelineError("Un fichier source est introuvable. Dépose-le de nouveau.");
      const path = join(dir, `source-${index}.${extension}`);
      await storage.downloadFile(key, path);
      return { path, mimeType, bytes: info.bytes };
    }),
  );
  return { kind, files };
}

/** §8.1 — Extraction en sections. Sautée si les sections existent déjà. */
export async function extractStep(ctx: Ctx, opts: { titleIsDefault: boolean }): Promise<void> {
  const { repo, ai, limits, workdir } = ctx.deps;
  if ((await repo.listSections(ctx.course.id)).length > 0) return;

  await setStatus(ctx, "extracting");
  const result = await billed(ctx, "extract", () =>
    workdir(async (dir) => ai.llm.extract(await loadSource(ctx, dir))),
  );
  await recordUsage(ctx, "extract", result.model, "standard", result.usage);

  // Échantillon d'un classeur : quelques minutes du début, pour juger la voix avant de tout payer.
  const extracted = normalizeSections(result.data.sections);
  const sections = ctx.course.is_sample ? sampleSection(extracted) : extracted;
  const sourceChars = sections.reduce((sum, s) => sum + s.content.length, 0);
  if (sourceChars > limits.maxSourceChars) {
    throw new PipelineError(
      `Ce cours fait ${sourceChars.toLocaleString("fr-FR")} caractères : la limite est de ${limits.maxSourceChars.toLocaleString("fr-FR")}. Découpe-le en plusieurs cours.`,
    );
  }

  await repo.insertSections(
    ctx.course.id,
    sections.map((s, idx) => ({
      idx,
      title: s.title.trim() || `Partie ${idx + 1}`,
      source_text: s.content,
      key_terms: s.keyTerms,
      key_facts: s.keyFacts,
    })),
  );

  // La taille réelle est connue : l'estimation est refaite avant les étapes coûteuses.
  const estimate = estimateCourse({
    sourceChars,
    sourceKind: ctx.course.source_kind as "pdf" | "images" | "text",
    pages: ctx.course.source_kind === "text" ? 0 : ctx.course.source_keys.length,
    mode: ctx.course.mode,
    measured: await repo.measuredCourses(ctx.userId, ctx.course.voice_id, ctx.course.mode),
    models: ai.models,
    at: ctx.deps.now(),
  });
  const combo = estimate.combos[comboKey(ctx.course.tier, ctx.course.quality)];
  await patchCourse(ctx, {
    source_chars: sourceChars,
    est_cost_usd: Number(combo.totalUsd.toFixed(4)),
    ...(opts.titleIsDefault ? { title: result.data.title.slice(0, 200) } : {}),
  });
  // Le budget est recontrôlé juste après, par `budgetGate`, y compris lors d'une reprise.
  await setStatus(ctx, "extracting", 1);
}
