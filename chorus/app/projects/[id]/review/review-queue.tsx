"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewCue } from "@/lib/db/script";
import type { CharacterWithStats } from "@/lib/db/characters";
import { api } from "@/lib/api/client";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/** Needs-review queue: assign a speaker to each low-confidence line with a dropdown. */
export function ReviewQueue({ projectId, initialCues, characters }: { projectId: string; initialCues: ReviewCue[]; characters: CharacterWithStats[] }) {
  const router = useRouter();
  const [cues, setCues] = useState(initialCues);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  void projectId;

  async function assign(cue: ReviewCue, characterId: string) {
    setBusy(cue.id);
    setError(null);
    try {
      await api.patch(`/api/cues/${cue.id}`, { character_id: characterId });
      setCues((prev) => prev.filter((c) => c.id !== cue.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign speaker");
    } finally {
      setBusy(null);
    }
  }

  if (cues.length === 0) {
    return <Notice tone="success">All lines are assigned. Nice work.</Notice>;
  }
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl">{cues.length} lines need a speaker</h2>
        <p className="text-sm text-muted">Chorus was not confident who says these. Pick the speaker; the line moves out of the queue as soon as you do.</p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ol className="space-y-4">
        {cues.map((cue) => (
          <li key={cue.id} className="rounded-lg border border-line bg-surface p-5">
            <div className="text-xs text-muted">{cue.chapter_title}</div>
            {cue.before_text ? <p className="mt-2 text-sm text-muted">…{cue.before_text.slice(-160)}</p> : null}
            <p className="script-text mt-2">“{cue.text}”</p>
            {cue.after_text ? <p className="mt-2 text-sm text-muted">{cue.after_text.slice(0, 160)}…</p> : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Select className="max-w-xs" defaultValue="" disabled={busy === cue.id} onChange={(e) => e.target.value && assign(cue, e.target.value)}>
                <option value="" disabled>
                  Who says this?
                </option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.canonical_name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" disabled={busy === cue.id} onClick={() => assign(cue, characters.find((c) => c.is_narrator)!.id)}>
                It&apos;s narration
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
