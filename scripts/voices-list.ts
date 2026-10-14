/**
 * Liste les voix prédéfinies du catalogue Gemini qui parlent français, pour en choisir de
 * meilleures que celles de départ (`PREBUILT_VOICES`). Lecture seule, gratuite.
 * Usage : pnpm voices:list [--all] [female|male] [low|medium|high]
 *   --all  ne filtre pas sur le français
 */
import { gemini } from "@/lib/gemini/client";

async function main() {
  const args = process.argv.slice(2);
  const gender = args.filter((a) => a === "female" || a === "male");
  const pitch = args.filter((a) => a === "low" || a === "medium" || a === "high");
  const filters = {
    type: ["prebuilt"],
    ...(args.includes("--all") ? {} : { language_code: ["fr-FR"] }),
    ...(gender.length > 0 ? { gender } : {}),
    ...(pitch.length > 0 ? { pitch } : {}),
  };

  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await gemini().voices.list({
      ...filters,
      page_size: 200,
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    for (const voice of page.voices ?? []) {
      total++;
      const traits = [voice.gender, voice.pitch, voice.persona, voice.context]
        .filter(Boolean)
        .join(" · ");
      console.log(`${voice.id ?? "?"} — ${traits}`);
      if (voice.description) console.log(`    ${voice.description}`);
    }
    pageToken = page.next_page_token || undefined;
  } while (pageToken);

  console.log(
    total === 0
      ? "Aucune voix : relance avec --all (le catalogue n'étiquette peut-être pas le français)."
      : `\n${total} voix. Pour en essayer une, ajoute son identifiant à PREBUILT_VOICES (src/lib/prompts/voice-presets.ts).`,
  );
}

main().catch((error: unknown) => {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exit(1);
});
