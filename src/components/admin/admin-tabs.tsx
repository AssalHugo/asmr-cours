import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Vue d'ensemble" },
  { href: "/admin/courses", label: "Tous les cours" },
] as const;

export function AdminTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Mode admin" className="bg-card mb-8 flex gap-1 rounded-full p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-sm transition-colors",
            tab.href === current
              ? "bg-raised text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
