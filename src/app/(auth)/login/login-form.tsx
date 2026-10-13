"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

const initial: LoginState = { status: "idle" };

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  if (state.status === "sent") {
    return (
      <div role="status" className="space-y-2 text-center">
        <p className="text-lg">C&apos;est parti.</p>
        <p className="text-muted-foreground">
          Si {state.email} est invitée, un lien de connexion l&apos;attend dans sa boîte. Murmure
          est un espace privé.
        </p>
      </div>
    );
  }

  const message =
    state.message ??
    (linkError ? "Ce lien a expiré ou a déjà servi. Demandes-en un nouveau." : undefined);

  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-2">
        <span className="text-sm">Ton email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          defaultValue={state.email}
          placeholder="toi@exemple.fr"
          className="border-input bg-background h-12 w-full rounded-xl border px-4"
        />
      </label>
      {message ? (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground h-12 w-full rounded-xl disabled:opacity-60"
      >
        {pending ? "Envoi…" : "Recevoir mon lien"}
      </button>
    </form>
  );
}
