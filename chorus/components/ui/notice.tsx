export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: React.ReactNode }) {
  const tones = {
    info: "border-line bg-surface text-ink-soft",
    warn: "border-gold bg-gold-soft text-ink",
    error: "border-danger/50 bg-record-soft text-danger",
    success: "border-moss bg-moss-soft text-ink",
  };
  return <div className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h3 className="text-xl">{title}</h3>
      {body ? <p className="mt-2 text-muted max-w-md mx-auto">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
