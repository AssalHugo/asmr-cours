import type { VoiceMode } from "@/lib/estimate";
import type { Segment } from "@/lib/pipeline/schemas";
import type { BillableUsage } from "@/lib/pricing";

export type { VoiceMode };
export type Usage = BillableUsage;

export type TtsRequest = {
  key: string;
  text: string;
  voiceId: string;
  style: string;
  model: string;
};
export type TtsResult = {
  key: string;
  wav: Buffer;
  sampleRate: number;
  durationMs: number;
  usage: Usage;
};

export type BatchPoll = {
  state: "running" | "done" | "failed";
  /** Requêtes du job restées sans audio. */
  failed?: number;
  error?: string;
};

/**
 * Synthèse vocale, pensée pour accueillir d'autres providers (ex. Fish Audio).
 * Écart avec la spec : `pollBatch` livre les résultats un à un par callback plutôt
 * qu'en tableau, pour ne jamais tenir une heure d'audio en mémoire.
 */
export interface TtsProvider {
  id: "gemini" | "mock";
  /** Applique les balises propres au provider. */
  renderChunkText(segments: Segment[]): string;
  /** Appel standard. */
  synthesize(req: TtsRequest): Promise<TtsResult>;
  /** Un seul job pour toutes les requêtes ; elles partagent le même modèle. */
  submitBatch?(reqs: TtsRequest[], label: string): Promise<{ jobId: string }>;
  pollBatch?(jobId: string, onResult: (result: TtsResult) => Promise<void>): Promise<BatchPoll>;
  cancelBatch?(jobId: string): Promise<void>;
}

export type DesignedVoice = { providerVoiceId: string; sampleWav: Buffer | null };

/** Création de voix (Studio voix). */
export interface VoiceDesigner {
  design(input: {
    description: string;
    label: string;
    model: string;
    gender?: "female" | "male";
  }): Promise<DesignedVoice>;
  replicate?(input: {
    label: string;
    model: string;
    sourceWav: Buffer;
    consentWav: Buffer;
  }): Promise<DesignedVoice>;
  remove(providerVoiceId: string): Promise<void>;
}
