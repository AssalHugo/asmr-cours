"use client";

import { Loader2, Sparkles, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  discardVoiceDraft,
  removeVoice,
  saveDesignedVoice,
  setDefaultVoice,
  tryVoiceDesign,
  type VoiceDraft,
} from "@/app/(app)/voices/actions";
import { Button } from "@/components/ui/button";
import { VoicePreviewButton } from "@/components/voice-preview-button";
import { cn } from "@/lib/utils";

export type StudioVoice = {
  id: string;
  label: string;
  description: string | null;
  kind: string;
  isDefault: boolean;
};

const KIND_LABEL: Record<string, string> = {
  prebuilt: "Voix Gemini",
  designed: "Voix créée",
  replicated: "Ta voix",
};

export function VoiceStudio({
  voices,
  suggestions,
}: {
  voices: StudioVoice[];
  suggestions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [trying, setTrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Un brouillon laissé en plan en quittant la page est supprimé chez Gemini, qui plafonne
  // le nombre de voix stockées par projet.
  const pendingDraft = useRef<string | null>(null);
  useEffect(() => {
    pendingDraft.current = draft?.providerVoiceId ?? null;
  }, [draft]);
  useEffect(
    () => () => {
      if (pendingDraft.current) void discardVoiceDraft(pendingDraft.current);
    },
    [],
  );

  async function tryIt() {
    setTrying(true);
    setError(null);
    const result = await tryVoiceDesign({ description }, draft?.providerVoiceId);
    setTrying(false);
    if (!result.ok) return setError(result.message);
    setDraft(result.data);
  }

  function keep() {
    if (!draft) return;
    startTransition(async () => {
      const result = await saveDesignedVoice({
        providerVoiceId: draft.providerVoiceId,
        label,
        description,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(`« ${label} » rejoint tes voix.`);
      setDraft(null);
      setDescription("");
      setLabel("");
      router.refresh();
    });
  }

  function drop() {
    if (!draft) return;
    const id = draft.providerVoiceId;
    setDraft(null);
    void discardVoiceDraft(id);
  }

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h2 className="text-2xl">Tes voix</h2>
        <ul className="space-y-3">
          {voices.map((voice) => (
            <li
              key={voice.id}
              className={cn(
                "bg-card space-y-3 rounded-2xl p-4",
                voice.isDefault && "ring-sand ring-2",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg">{voice.label}</h3>
                  <p className="text-muted-foreground text-sm">
                    {KIND_LABEL[voice.kind] ?? voice.kind}
                    {voice.isDefault ? " · par défaut" : ""}
                  </p>
                </div>
                {voice.kind !== "prebuilt" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    aria-label={`Supprimer la voix ${voice.label}`}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Supprimer la voix « ${voice.label} » ? Les cours déjà générés restent écoutables.`,
                        )
                      )
                        return;
                      startTransition(async () => {
                        const result = await removeVoice(voice.id);
                        if (result.ok) toast("Voix supprimée.");
                        else toast.error(result.message);
                        router.refresh();
                      });
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
              {voice.description ? (
                <p className="text-muted-foreground text-sm">{voice.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <VoicePreviewButton voiceId={voice.id} mode="whisper" label="Chuchoté" />
                <VoicePreviewButton voiceId={voice.id} mode="soft" label="Doux" />
                {!voice.isDefault ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setDefaultVoice(voice.id);
                        if (!result.ok) toast.error(result.message);
                        router.refresh();
                      })
                    }
                  >
                    <Star aria-hidden />
                    Choisir par défaut
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Créer une voix</h2>
        <p className="text-muted-foreground">
          Décris en une ou deux phrases ce qui ne change jamais : âge, timbre, texture, débit,
          distance au micro. Une voix par mode : un chuchotement ne fait pas une bonne voix douce.
          Écoute, ajuste, puis garde celle qui te plaît.
        </p>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={600}
          placeholder="Une femme calme, voix grave et soufflée, tout près du micro…"
          aria-label="Description de la voix"
          className="bg-card placeholder:text-muted-foreground w-full rounded-2xl p-4"
        />
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion, index) => (
            <Button
              key={suggestion}
              variant="secondary"
              size="sm"
              onClick={() => setDescription(suggestion)}
            >
              Exemple {index + 1}
            </Button>
          ))}
        </div>
        <Button
          className="w-full"
          disabled={trying || description.trim().length < 20}
          onClick={() => void tryIt()}
        >
          {trying ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {draft ? "Réessayer avec cette description" : "Écouter un essai"}
        </Button>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {draft ? (
          <div className="bg-card space-y-4 rounded-2xl p-4">
            <h3 className="text-lg">Ton essai</h3>
            {draft.sample ? (
              <>
                <audio controls src={draft.sample} className="w-full" />
                <p className="text-muted-foreground text-sm">
                  Extrait brut de Gemini. L&apos;aperçu fidèle à tes cours (même réglages, même
                  mixage) est créé quand tu gardes la voix.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Pas d&apos;extrait pour cet essai : garde la voix pour l&apos;écouter.
              </p>
            )}
            <label className="block space-y-2">
              <span className="text-muted-foreground text-sm">Nom de la voix</span>
              <input
                value={label}
                maxLength={60}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Murmure du soir"
                className="bg-background h-12 w-full rounded-xl px-4"
              />
            </label>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                // Pas pendant un nouvel essai : il supprime justement ce brouillon.
                disabled={pending || trying || label.trim().length === 0}
                onClick={keep}
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Garder cette voix
              </Button>
              <Button variant="ghost" disabled={pending || trying} onClick={drop}>
                Abandonner
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
