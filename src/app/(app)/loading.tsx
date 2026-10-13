import { BreathOrb } from "@/components/breath-orb";

export default function Loading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="Chargement"
    >
      <BreathOrb size="sm" />
    </div>
  );
}
