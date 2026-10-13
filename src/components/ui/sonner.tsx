"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Toasts aux couleurs du thème courant (les variables CSS suivent le thème). */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "1rem",
        } as React.CSSProperties
      }
      toastOptions={{ style: { fontFamily: "var(--font-body)", fontSize: "1rem" } }}
      {...props}
    />
  );
}

export { Toaster };
