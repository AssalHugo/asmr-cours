"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearOffline } from "@/lib/offline";

/** Déconnexion : les cours gardés hors-ligne quittent l'appareil avec la session. */
export function SignOutForm() {
  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (form.dataset.cleared) return;
        event.preventDefault();
        void clearOffline()
          .catch(() => undefined)
          .finally(() => {
            form.dataset.cleared = "true";
            form.submit();
          });
      }}
    >
      <Button type="submit" variant="ghost" className="-ml-4">
        <LogOut aria-hidden />
        Se déconnecter
      </Button>
    </form>
  );
}
