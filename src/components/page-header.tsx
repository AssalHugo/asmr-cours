import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function PageHeader({
  title,
  lead,
  back,
  action,
}: {
  title: string;
  lead?: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-8 space-y-3">
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground -ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm"
        >
          <ChevronLeft className="size-5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-end justify-between gap-4">
        <h1 className="line-clamp-3 text-3xl leading-tight sm:text-4xl">{title}</h1>
        {action}
      </div>
      {lead ? <p className="text-muted-foreground max-w-prose">{lead}</p> : null}
    </header>
  );
}
