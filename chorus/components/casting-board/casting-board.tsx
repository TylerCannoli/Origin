"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CharacterWithStats } from "@/lib/db/characters";
import type { Voice } from "@/lib/tts/types";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CharacterCard } from "./character-card";
import { EditCharacterDialog } from "./edit-character-dialog";
import { MergeDialog } from "./merge-dialog";
import { InviteDialog } from "./invite-dialog";

export function CastingBoard({
  projectId,
  initialCharacters,
  voices,
  voiceError,
  appUrl,
}: {
  projectId: string;
  initialCharacters: CharacterWithStats[];
  voices: Voice[];
  voiceError: string | null;
  appUrl: string;
}) {
  const router = useRouter();
  const [characters, setCharacters] = useState(initialCharacters);
  const [showExcluded, setShowExcluded] = useState(false);
  const [editing, setEditing] = useState<CharacterWithStats | null>(null);
  const [merging, setMerging] = useState<CharacterWithStats | null>(null);
  const [inviting, setInviting] = useState<CharacterWithStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => characters.filter((c) => showExcluded || !c.is_excluded), [characters, showExcluded]);
  const excludedCount = characters.filter((c) => c.is_excluded).length;
  const totalLines = characters.reduce((n, c) => n + c.line_count, 0);
  const recordedLines = characters.reduce((n, c) => n + c.recorded_count, 0);

  async function refresh() {
    const { characters: next } = await api.get<{ characters: CharacterWithStats[] }>(`/api/projects/${projectId}/characters`);
    setCharacters(next);
    router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api.patch(`/api/characters/${id}`, body);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update character");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl">Cast</h2>
          <p className="text-sm text-muted">
            {characters.filter((c) => !c.is_excluded).length} speaking parts, {recordedLines} of {totalLines} lines recorded. Unrecorded lines use each character&apos;s AI voice.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {excludedCount > 0 ? (
            <label className="flex items-center gap-2 text-muted">
              <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
              Show {excludedCount} excluded
            </label>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setInviting({ id: "", canonical_name: "the whole project" } as CharacterWithStats)}>
            Share casting link
          </Button>
        </div>
      </div>

      {voiceError ? <Notice tone="warn">Voice library unavailable: {voiceError}. Voice previews are disabled until the TTS provider is configured.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <ul className="grid gap-4 md:grid-cols-2">
        {visible.map((c) => (
          <CharacterCard
            key={c.id}
            character={c}
            voices={voices}
            appUrl={appUrl}
            onEdit={() => setEditing(c)}
            onMerge={() => setMerging(c)}
            onInvite={() => setInviting(c)}
            onExclude={(excluded) => patch(c.id, { is_excluded: excluded })}
            onClaim={(claim) => patch(c.id, { claim_self: claim })}
            onVoiceChange={async (voiceId) => {
              setError(null);
              try {
                await api.patch(`/api/characters/${c.id}/voice`, { ai_voice_id: voiceId });
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not change voice");
              }
            }}
          />
        ))}
      </ul>

      {editing ? (
        <EditCharacterDialog
          character={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await patch(editing.id, body);
            setEditing(null);
          }}
        />
      ) : null}
      {merging ? (
        <MergeDialog
          source={merging}
          candidates={characters.filter((c) => c.id !== merging.id && !c.is_narrator && !c.is_excluded)}
          onClose={() => setMerging(null)}
          onMerge={async (targetId) => {
            setError(null);
            try {
              await api.post(`/api/characters/${merging.id}/merge`, { into_character_id: targetId });
              setMerging(null);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not merge");
            }
          }}
        />
      ) : null}
      {inviting ? <InviteDialog projectId={projectId} character={inviting.id ? inviting : null} appUrl={appUrl} onClose={() => setInviting(null)} /> : null}
    </div>
  );
}
