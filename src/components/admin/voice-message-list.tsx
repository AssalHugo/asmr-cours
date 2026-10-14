"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteVoiceMessage } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import type { AdminVoiceMessage } from "@/lib/admin";
import { formatClock, formatDateTime } from "@/lib/format";

export function VoiceMessageList({ messages }: { messages: AdminVoiceMessage[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (messages.length === 0) return null;
  return (
    <ul className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className="bg-card space-y-3 rounded-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <p>
                {m.atMs === null ? "Au lancement" : `À ${formatClock(m.atMs)}`}
                <span className="text-muted-foreground"> · {formatClock(m.durationMs)}</span>
              </p>
              <p className={m.playedAt ? "text-sand" : "text-muted-foreground"}>
                {m.playedAt ? `Entendu le ${formatDateTime(m.playedAt)}` : "Pas encore entendu"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Supprimer ce message"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteVoiceMessage(m.id);
                  if (!result.ok) toast.error(result.message);
                  router.refresh();
                })
              }
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
          <audio controls preload="none" src={`/api/messages/${m.id}`} className="w-full" />
        </li>
      ))}
    </ul>
  );
}
