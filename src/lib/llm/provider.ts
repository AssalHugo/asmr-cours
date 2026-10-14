import type { SourceFile } from "@/lib/gemini/files";
import type {
  ExtractedCourse,
  ExtractedSection,
  Script,
  VerifyReport,
} from "@/lib/pipeline/schemas";
import type { BillableUsage } from "@/lib/pricing";
import type { ReexplainContext, ReexplainRequest } from "@/lib/prompts/reexplain";
import type { RewriteContext, RewriteFeedback } from "@/lib/prompts/rewrite";

export type { SourceFile };

export type ExtractInput =
  { kind: "text"; text: string } | { kind: "pdf" | "images"; files: SourceFile[] };

export type RewriteInput = {
  section: ExtractedSection;
  ctx: RewriteContext;
  feedback?: RewriteFeedback;
};

export type ReexplainInput = ReexplainRequest & { ctx: ReexplainContext };

export type LlmResult<T> = { data: T; model: string; usage: BillableUsage };

/** Étapes texte du pipeline. Toute sortie est déjà validée par son schéma zod. */
export interface LlmProvider {
  id: "gemini" | "mock";
  extract(input: ExtractInput): Promise<LlmResult<ExtractedCourse>>;
  rewrite(input: RewriteInput): Promise<LlmResult<Script>>;
  verify(section: ExtractedSection, script: Script): Promise<LlmResult<VerifyReport>>;
  /** Réécrit un seul passage, plus simplement et avec un exemple (« Réexplique-moi autrement »). */
  reexplain(input: ReexplainInput): Promise<LlmResult<Script>>;
}
