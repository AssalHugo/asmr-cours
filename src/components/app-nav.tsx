"use client";

import { AudioLines, BookOpen, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/library", label: "Bibliothèque", icon: BookOpen },
  { href: "/new", label: "Nouveau", icon: Plus },
  { href: "/voices", label: "Voix", icon: AudioLines },
  { href: "/settings", label: "Réglages", icon: SlidersHorizontal },
] as const;

/** Navigation basse : tout se fait au pouce, d'une seule main. */
export function AppNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/play/")) return null;
  return (
    <nav
      aria-label="Navigation principale"
      className="border-border bg-background/85 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between px-2">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            pathname.startsWith(`${href}/`) ||
            (href === "/library" && pathname.startsWith("/courses/"));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs transition-colors",
                  active ? "text-sand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-6" strokeWidth={active ? 2.2 : 1.6} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
