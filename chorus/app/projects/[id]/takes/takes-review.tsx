"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TakeRow } from "./page";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function TakesReview({ initialTakes }: { initialTakes: TakeRow[] }) {
  const router = useRouter();
  const [takes, setTakes] = useState(initialTakes);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: "approved" | "rejected" | "submitted") {
    setError(null);
    try {
      await api.patch(`/api/recordings/${id}`, { status });
      setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update take");
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this take?")) return;
    try {
      await api.delete(`/api/recordings/${id}`);
      setTakes((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete take");
    }
  }

  const grouped = new Map<string, TakeRow[]>();
  for (const t of takes) grouped.set(t.cue_id, [...(grouped.get(t.cue_id) ?? []), t]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        The newest approved take is used for each line; if none is approved, the newest submitted take is used. Rejected takes are never used.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {[...grouped.entries()].map(([cueId, group]) => {
        const first = group[0];
        return (
          <section key={cueId} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-xs text-muted">
              {first.chapter_title} · {first.character_name}
            </div>
            <p className="script-text mt-1">{first.cue_type === "dialogue" ? `“${first.cue_text}”` : first.cue_text}</p>
            <ul className="mt-3 space-y-2">
              {group.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-strong px-3 py-2 text-sm">
                  <audio controls preload="none" src={`/api/recordings/${t.id}/audio`} className="h-8 max-w-[16rem] flex-1" />
                  <span className="text-muted">{t.recorder_email ?? "guest"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${t.status === "approved" ? "bg-moss-soft" : t.status === "rejected" ? "bg-record-soft text-danger" : "bg-gold-soft"}`}
                  >
                    {t.status}
                  </span>
                  <span className="flex-1" />
                  {t.status !== "approved" ? (
                    <Button size="sm" variant="secondary" onClick={() => setStatus(t.id, "approved")}>
                      Approve
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "submitted")}>
                      Unapprove
                    </Button>
                  )}
                  {t.status !== "rejected" ? (
                    <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "rejected")}>
                      Reject
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
