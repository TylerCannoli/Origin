"use client";
import { useEffect, useState } from "react";
import type { CharacterWithStats } from "@/lib/db/characters";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api/client";

/** Generates a casting link for one character (or the whole project) and shows it for copying. */
export function InviteDialog({ projectId, character, onClose }: { projectId: string; character: CharacterWithStats | null; appUrl: string; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = character ? `/api/characters/${character.id}/invite` : `/api/projects/${projectId}/invite`;
    api
      .post<{ link: string }>(url, { expires_in_days: 30 })
      .then((r) => setLink(r.link))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not create link"));
  }, [projectId, character]);

  return (
    <Dialog title={character ? `Invite someone to voice ${character.canonical_name}` : "Share the casting board"} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        {character
          ? "Anyone with this link can see this character's lines and record them from their phone or browser. No account needed. The link works for 30 days."
          : "Anyone with this link can pick an unclaimed character and record its lines. No account needed. The link works for 30 days."}
      </p>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Input readOnly value={link ?? "Creating link…"} onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          disabled={!link}
          onClick={async () => {
            if (!link) return;
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
