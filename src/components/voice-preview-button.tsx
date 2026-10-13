"use client";

import { Loader2, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { previewVoice } from "@/app/(app)/voices/actions";
import { Button } from "@/components/ui/button";

/** « Écouter la voix » : joue l'échantillon de la voix dans le mode choisi. */
export function VoicePreviewButton({
  voiceId,
  mode,
  label = "Écouter",
}: {
  voiceId: string;
  mode: "whisper" | "soft";
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  async function toggle() {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    const result = await previewVoice(voiceId, mode);
    if (!result.ok) {
      toast.error(result.message);
      setState("idle");
      return;
    }
    const player = (audio.current ??= new Audio());
    player.src = result.data.url;
    player.onended = () => setState("idle");
    player.onerror = () => {
      toast.error("L'échantillon n'a pas pu être lu.");
      setState("idle");
    };
    await player.play().catch(() => setState("idle"));
    setState("playing");
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void toggle()}
      disabled={state === "loading"}
    >
      {state === "loading" ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : state === "playing" ? (
        <Square aria-hidden />
      ) : (
        <Volume2 aria-hidden />
      )}
      {state === "playing" ? "Arrêter" : label}
    </Button>
  );
}
