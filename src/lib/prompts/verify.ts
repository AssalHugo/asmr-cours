import type { ExtractedSection, Script } from "@/lib/pipeline/schemas";

export const VERIFY_PROMPT_VERSION = "verify-v1";

export const VERIFY_SYSTEM = `Tu contrôles la fidélité d'un script audio par rapport à sa source.
Entrées : la section source (content, keyTerms, keyFacts) et le script (segments).
Signale uniquement :
- missingFacts : keyFacts absents du script ;
- alteredFacts : faits présents mais modifiés (chiffre, terme, sens) ;
- inventedClaims : affirmations factuelles du script absentes de la source
  (les analogies présentées comme telles sont permises).
ok = true seulement si les trois listes sont vides.
Réponds uniquement avec le JSON demandé.`;

export function renderVerifyUser(section: ExtractedSection, script: Script): string {
  return JSON.stringify(
    {
      source: {
        content: section.content,
        keyTerms: section.keyTerms,
        keyFacts: section.keyFacts,
      },
      script: { segments: script.segments.map((s) => s.text) },
    },
    null,
    2,
  );
}
