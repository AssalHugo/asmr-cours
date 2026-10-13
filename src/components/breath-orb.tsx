import { cn } from "@/lib/utils";

/**
 * Le souffle : signature visuelle de Murmure. Un disque qui respire sur 5,5 s,
 * entouré d'un halo. Sert au bouton lecture et à l'attente d'une génération.
 */
export function BreathOrb({
  size = "md",
  breathing = true,
  className,
  children,
}: {
  size?: "sm" | "md" | "lg";
  breathing?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const box = { sm: "size-14", md: "size-24", lg: "size-36" }[size];
  return (
    <span className={cn("relative inline-flex items-center justify-center", box, className)}>
      <span
        aria-hidden
        className={cn(
          "bg-lavender/40 absolute inset-0 rounded-full blur-xl",
          breathing ? "animate-halo" : "opacity-25",
        )}
      />
      <span
        className={cn(
          "bg-primary text-primary-foreground shadow-glow relative flex size-full items-center justify-center rounded-full",
          breathing && "animate-breathe",
        )}
      >
        {children}
      </span>
    </span>
  );
}
