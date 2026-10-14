export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card space-y-1 rounded-3xl p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="font-heading tabular text-3xl">{value}</p>
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
    </div>
  );
}
