"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const KEY = "murmure-theme";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const isDark = () => document.documentElement.classList.contains("dark");

/** Nuit par défaut ; le thème crème est un choix gardé sur l'appareil. */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => true);
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Stockage indisponible : le choix vaut pour cette visite.
    }
    listeners.forEach((listener) => listener());
  }
  return (
    <Button type="button" variant="secondary" onClick={toggle}>
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      {dark ? "Passer au thème crème" : "Passer au thème nuit"}
    </Button>
  );
}
