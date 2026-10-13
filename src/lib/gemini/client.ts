import "server-only";
import { GoogleGenAI } from "@google/genai";
import { geminiEnv } from "@/lib/env";

let cached: GoogleGenAI | undefined;

/** Client Gemini du projet courant (clé dev ou prod selon l'environnement). */
export function gemini(): GoogleGenAI {
  cached ??= new GoogleGenAI({ apiKey: geminiEnv().GEMINI_API_KEY });
  return cached;
}

export type Gemini = GoogleGenAI;

export type TextContent = { type: "text"; text: string };
export type MediaContent =
  | { type: "document"; mime_type: string; data?: string; uri?: string }
  | { type: "image"; mime_type: string; data?: string; uri?: string };
/** Entrée d'une interaction texte : une chaîne, ou un tour utilisateur multimodal. */
export type InteractionInput =
  string | { type: "user_input"; content: (TextContent | MediaContent)[] }[];
