"use client";

import { cn } from "@/lib/utils";

export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

/** Groupe de choix exclusifs en pastilles, bâti sur de vrais boutons radio. */
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-muted-foreground text-sm">{legend}</legend>
      <div
        className={cn(
          "grid gap-2",
          { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[columns],
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "bg-card has-checked:bg-raised has-checked:ring-sand has-focus-visible:outline-ring flex min-h-14 cursor-pointer flex-col justify-center rounded-2xl px-4 py-2.5 ring-1 ring-transparent transition-colors has-checked:ring-2 has-focus-visible:outline-2",
              option.disabled && "cursor-not-allowed opacity-45",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span>{option.label}</span>
            {option.hint ? (
              <span className="text-muted-foreground text-sm">{option.hint}</span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
