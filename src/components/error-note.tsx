import { TriangleAlert } from "lucide-react";

/** Message d'erreur sous un formulaire, annoncé aux lecteurs d'écran. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
