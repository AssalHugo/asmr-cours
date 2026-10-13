import "server-only";
import { z } from "zod";
import type { BillableUsage } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini, type InteractionInput } from "./client";
import { textUsage } from "./usage";

/** Sortie inexploitable. L'appel a tout de même été facturé : `usage` et `model` le disent. */
export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly model?: string,
    readonly usage?: BillableUsage,
  ) {
    super(message);
    this.name = "LlmOutputError";
  }
}

/** Niveau de thinking le plus bas accepté : `minimal` pour Flash-Lite, `low` pour Flash. */
export function minThinkingLevel(model: string): "minimal" | "low" {
  return model.includes("flash-lite") ? "minimal" : "low";
}

// Mots-clés JSON Schema hors du sous-ensemble accepté par Gemini : la validation
// correspondante reste faite par zod sur la réponse.
const UNSUPPORTED_KEYWORDS = new Set(["$schema", "minLength", "maxLength", "pattern", "default"]);

/** Convertit un schéma zod en JSON Schema limité au sous-ensemble accepté par Gemini. */
export function geminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (typeof node !== "object" || node === null) return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export type JsonRequest<T> = {
  model: string;
  system: string;
  input: InteractionInput;
  schema: z.ZodType<T>;
};

/** Appel texte à sortie JSON structurée, validée par zod, thinking au minimum. */
export async function generateJson<T>(
  req: JsonRequest<T>,
): Promise<{ data: T; usage: BillableUsage }> {
  const interaction = await withRetry(
    () =>
      gemini().interactions.create(
        {
          model: req.model,
          system_instruction: req.system,
          input: req.input,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: geminiJsonSchema(req.schema),
          },
          generation_config: { thinking_level: minThinkingLevel(req.model) },
          store: false,
        },
        { retries: { strategy: "none" } },
      ),
    { label: req.model },
  );
  const usage = textUsage(interaction.usage);
  if (interaction.status !== "completed" || !interaction.output_text) {
    throw new LlmOutputError(
      `Réponse ${req.model} incomplète (statut ${interaction.status}).`,
      req.model,
      usage,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(interaction.output_text);
  } catch {
    throw new LlmOutputError(`Réponse ${req.model} illisible : JSON invalide.`, req.model, usage);
  }
  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    throw new LlmOutputError(
      `Réponse ${req.model} hors schéma : ${z.prettifyError(parsed.error)}`,
      req.model,
      usage,
    );
  }
  return { data: parsed.data, usage };
}
