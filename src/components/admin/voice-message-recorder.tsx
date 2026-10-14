"use client";

import { Loader2, Mic, RotateCcw, Send, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createVoiceMessage, prepareVoiceMessage } from "@/app/(app)/admin/actions";
import { Choice } from "@/components/choice";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { MAX_MESSAGE_MS, parseClock, pickRecorderMime } from "@/lib/voice-messages";

type Recording = { blob: Blob; url: string; durationMs: number };
type When = "launch" | "at";

/** Enregistre un message au micro et le dépose dans le cours, au lancement ou à un instant. */
export function VoiceMessageRecorder({
  courseId,
  courseDurationMs,
}: {
  courseId: string;
  courseDurationMs: number | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "recording" | "sending">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [when, setWhen] = useState<When>("launch");
  const [at, setAt] = useState("0:30");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(
    () => () => {
      clearInterval(tickRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => () => (recording ? URL.revokeObjectURL(recording.url) : undefined), [recording]);

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Ce navigateur ne sait pas enregistrer le micro.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      toast.error("Accès au micro refusé. Autorise-le dans les réglages du navigateur.");
      return;
    }
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearInterval(tickRef.current);
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      const durationMs = Math.min(MAX_MESSAGE_MS, Math.max(1, Date.now() - startedAt));
      setRecording({ blob, url: URL.createObjectURL(blob), durationMs });
      setPhase("idle");
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setElapsedMs(0);
    setPhase("recording");
    tickRef.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsedMs(ms);
      if (ms >= MAX_MESSAGE_MS && recorder.state === "recording") recorder.stop();
    }, 250);
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function send() {
    if (!recording) return;
    let atMs: number | null = null;
    if (when === "at") {
      atMs = parseClock(at);
      if (atMs === null) {
        toast.error("Moment illisible : écris par exemple 12:30.");
        return;
      }
      if (courseDurationMs !== null && atMs >= courseDurationMs) {
        toast.error(`Le cours dure ${formatClock(courseDurationMs)} : choisis un moment avant.`);
        return;
      }
    }
    setPhase("sending");
    try {
      const mime = recording.blob.type;
      const prepared = await prepareVoiceMessage({
        courseId,
        mime,
        bytes: recording.blob.size,
      });
      if (!prepared.ok) throw new Error(prepared.message);
      const put = await fetch(prepared.data.url, {
        method: "PUT",
        headers: prepared.data.headers,
        body: recording.blob,
      });
      if (!put.ok) throw new Error("L'envoi de l'enregistrement a échoué.");
      const created = await createVoiceMessage({
        courseId,
        messageId: prepared.data.messageId,
        mime,
        durationMs: Math.round(recording.durationMs),
        atMs,
      });
      if (!created.ok) throw new Error(created.message);
      toast.success("Message déposé. Il passera une seule fois.");
      setRecording(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "L'envoi a échoué.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="bg-card space-y-5 rounded-3xl p-5">
      {phase === "recording" ? (
        <div className="flex items-center justify-between gap-4">
          <p className="tabular flex items-center gap-2" role="status">
            <span className="bg-destructive size-3 animate-pulse rounded-full" aria-hidden />
            {formatClock(elapsedMs)}
            <span className="text-muted-foreground text-sm">/ {formatClock(MAX_MESSAGE_MS)}</span>
          </p>
          <Button variant="destructive" onClick={stop}>
            <Square aria-hidden />
            Arrêter
          </Button>
        </div>
      ) : recording ? (
        <div className="space-y-5">
          <audio controls src={recording.url} className="w-full" />
          <Choice<When>
            legend="Quand doit-elle l'entendre ?"
            name="when"
            value={when}
            onChange={setWhen}
            options={[
              { value: "launch", label: "Au lancement" },
              {
                value: "at",
                label: "À un moment précis",
                disabled: courseDurationMs === null,
              },
            ]}
          />
          {when === "at" ? (
            <label className="block space-y-2">
              <span className="text-muted-foreground text-sm">
                Moment dans le cours (minutes:secondes)
                {courseDurationMs ? `, avant ${formatClock(courseDurationMs)}` : ""}
              </span>
              <input
                value={at}
                onChange={(e) => setAt(e.target.value)}
                inputMode="numeric"
                placeholder="12:30"
                className="bg-background tabular h-12 w-full rounded-full px-5"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={send} disabled={phase === "sending"}>
              {phase === "sending" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              Envoyer
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRecording(null)}
              disabled={phase === "sending"}
            >
              <RotateCcw aria-hidden />
              Recommencer
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Elle l&apos;entendra une seule fois, au lancement du cours ou au moment choisi. Le cours
            se met en pause le temps du message.
          </p>
          <Button onClick={start}>
            <Mic aria-hidden />
            Enregistrer un message
          </Button>
        </div>
      )}
    </div>
  );
}
