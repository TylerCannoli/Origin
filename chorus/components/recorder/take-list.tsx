"use client";
import type { RecordingRow } from "@/lib/db/types";
import { Button } from "@/components/ui/button";

export function TakeList({ recordings, token, onDelete }: { recordings: RecordingRow[]; token: string; onDelete: (id: string) => void }) {
  if (recordings.length === 0) return null;
  return (
    <ul className="space-y-2">
      {recordings.map((r, i) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-strong px-3 py-2 text-sm">
          <span className="text-muted">Take {recordings.length - i}</span>
          <audio controls preload="none" src={`/api/recordings/${r.id}/audio?token=${encodeURIComponent(token)}`} className="h-8 max-w-[14rem] flex-1" />
          {r.status === "approved" ? <span className="rounded-full bg-moss-soft px-2 py-0.5 text-xs">approved</span> : null}
          <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)}>
            Delete
          </Button>
        </li>
      ))}
    </ul>
  );
}
