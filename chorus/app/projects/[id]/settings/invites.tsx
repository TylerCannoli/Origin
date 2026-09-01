"use client";
import { useState } from "react";
import type { CastingInviteRow } from "@/lib/db/types";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

type InviteRow = CastingInviteRow & { character_name: string | null };

/** Active casting links with revoke controls. */
export function InvitesPanel({ initial, appUrl }: { initial: InviteRow[]; appUrl: string }) {
  const [invites, setInvites] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  async function revoke(id: string) {
    if (!confirm("Turn off this casting link? Takes already recorded through it are kept.")) return;
    try {
      await api.delete(`/api/invites/${id}`);
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke link");
    }
  }
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h2 className="text-2xl">Casting links</h2>
      <p className="mt-1 text-sm text-muted">Anyone with an active link can record the part it points to. Turn a link off to stop that.</p>
      {error ? <div className="mt-3"><Notice tone="error">{error}</Notice></div> : null}
      {invites.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No active links. Create one from the casting board.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line text-sm">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{i.character_name ?? "Whole project"}</span>
              <span className="truncate text-muted">{`${appUrl}/record/${i.token}`}</span>
              <span className="text-xs text-muted">{i.expires_at ? `expires ${new Date(i.expires_at).toLocaleDateString()}` : "no expiry"}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>
                Turn off
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
