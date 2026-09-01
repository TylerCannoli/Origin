/** Decorative or live waveform bars. `live` animates the bars. */
export function Wave({ bars = 12, live = false, className = "", seed = 3 }: { bars?: number; live?: boolean; className?: string; seed?: number }) {
  const items = Array.from({ length: bars }, (_, i) => {
    const h = 30 + Math.abs(Math.sin((i + seed) * 1.7)) * 70;
    return <i key={i} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />;
  });
  return (
    <span aria-hidden className={`wave ${live ? "live" : ""} ${className}`}>
      {items}
    </span>
  );
}
