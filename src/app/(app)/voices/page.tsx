import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { VoiceStudio } from "@/components/voice-studio";
import { requireUser } from "@/lib/auth";
import { getProfile, listVoices } from "@/lib/data";
import { VOICE_PRESETS_FR } from "@/lib/prompts/voice-presets";

export const metadata: Metadata = { title: "Studio voix" };

export default async function VoicesPage() {
  const user = await requireUser();
  const [profile, voices] = await Promise.all([getProfile(user.id), listVoices(user.id)]);
  const defaultId = profile.default_voice_id ?? voices[0]?.id;
  return (
    <main>
      <PageHeader title="Studio voix" lead="Les voix qui te lisent tes cours." />
      <VoiceStudio
        voices={voices.map((v) => ({
          id: v.id,
          label: v.label,
          description: v.description,
          kind: v.kind,
          isDefault: v.id === defaultId,
        }))}
        suggestions={VOICE_PRESETS_FR.map((p) => p.description)}
      />
    </main>
  );
}
