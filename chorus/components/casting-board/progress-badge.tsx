export function ProgressBadge({ recorded, total }: { recorded: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((recorded / total) * 100);
  const tone = total === 0 ? "border-line text-muted" : pct === 100 ? "border-moss bg-moss-soft" : pct > 0 ? "border-gold bg-gold-soft" : "border-line bg-surface-strong text-muted";
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${tone}`} title={`${recorded} of ${total} lines recorded`}>
      {recorded}/{total} lines
    </span>
  );
}
