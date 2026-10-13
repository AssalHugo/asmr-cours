"use client";

import * as React from "react";
import { cn } from "cn";
import { Slider as SliderPrimitive } from "radix-ui";

/**
 * Curseur à une poignée. Le nom accessible et le texte de valeur vont sur la poignée
 * (c'est elle qui porte le rôle `slider`), et la zone tactile fait 44 px de haut.
 */
function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex min-h-11 w-full touch-none items-center select-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="bg-sand absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className="bg-foreground ring-ring/40 relative block size-5 shrink-0 rounded-full shadow-md transition-shadow select-none after:absolute after:-inset-3 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden active:ring-4"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
