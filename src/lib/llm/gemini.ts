import "server-only";
import { env } from "@/lib/env";
import { mediaContents } from "@/lib/gemini/files";
import { generateJson } from "@/lib/gemini/text";
import { ExtractedCourse, Script, VerifyReport } from "@/lib/pipeline/schemas";
import { EXTRACT_SYSTEM, renderExtractUser } from "@/lib/prompts/extract";
import { renderRewriteSystem, renderRewriteUser } from "@/lib/prompts/rewrite";
import { renderVerifyUser, VERIFY_SYSTEM } from "@/lib/prompts/verify";
import type { LlmProvider } from "./provider";

export function createGeminiLlm(): LlmProvider {
  const { GEMINI_MODEL_TEXT: textModel, GEMINI_MODEL_CHECK: checkModel } = env();

  return {
    id: "gemini",

    async extract(input) {
      const text = renderExtractUser(input.kind, input.kind === "text" ? input.text : undefined);
      const content =
        input.kind === "text"
          ? [{ type: "text" as const, text }]
          : [...(await mediaContents(input.kind, input.files)), { type: "text" as const, text }];
      const { data, usage } = await generateJson({
        model: textModel,
        system: EXTRACT_SYSTEM,
        input: [{ type: "user_input", content }],
        schema: ExtractedCourse,
      });
      return { data, usage, model: textModel };
    },

    async rewrite({ section, ctx, feedback }) {
      const { data, usage } = await generateJson({
        model: textModel,
        system: renderRewriteSystem(ctx),
        input: renderRewriteUser(section, feedback),
        schema: Script,
      });
      return { data, usage, model: textModel };
    },

    async verify(section, script) {
      const { data, usage } = await generateJson({
        model: checkModel,
        system: VERIFY_SYSTEM,
        input: renderVerifyUser(section, script),
        schema: VerifyReport,
      });
      return { data, usage, model: checkModel };
    },
  };
}
