import type { ProjectStatus } from "@/lib/db/types";

const styles: Record<ProjectStatus, string> = {
  draft: "bg-surface-strong text-muted border-line",
  processing: "bg-gold-soft text-ink border-gold",
  ready: "bg-moss-soft text-ink border-moss",
  error: "bg-record-soft text-danger border-danger/40",
};
const labels: Record<ProjectStatus, string> = { draft: "Draft", processing: "Processing", ready: "Ready", error: "Needs attention" };

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${styles[status]}`}>{labels[status]}</span>;
}
