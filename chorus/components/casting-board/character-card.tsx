"use client";
import type { CharacterWithStats } from "@/lib/db/characters";
import type { Voice } from "@/lib/tts/types";
import { Button } from "@/components/ui/button";
import { VoicePicker } from "./voice-picker";
import { ProgressBadge } from "./progress-badge";

export function CharacterCard({
  character: c,
  voices,
  onEdit,
  onMerge,
  onInvite,
  onExclude,
  onClaim,
  onVoiceChange,
}: {
  character: CharacterWithStats;
  voices: Voice[];
  appUrl: string;
  onEdit: () => void;
  onMerge: () => void;
  onInvite: () => void;
  onExclude: (excluded: boolean) => void;
  onClaim: (claim: boolean) => void;
  onVoiceChange: (voiceId: string) => void;
}) {
  const traits = [c.inferred_age_range?.replace("_", " "), c.inferred_gender_presentation].filter(Boolean).join(", ");
  return (
    <li className={`rounded-lg border bg-surface p-5 ${c.is_excluded ? "border-dashed border-line opacity-70" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-2xl">{c.canonical_name}</h3>
          {c.aliases?.length ? <p className="truncate text-sm text-muted">also {c.aliases.join(", ")}</p> : null}
        </div>
        <ProgressBadge recorded={c.recorded_count} total={c.line_count} />
      </div>
      {c.blurb ? <p className="mt-3 text-ink-soft">{c.blurb}</p> : null}
      {traits ? <p className="mt-1 text-xs text-muted">Reads as {traits}. Only used to pick a default voice.</p> : null}

      <div className="mt-4 border-t border-line pt-4">
        <VoicePicker voices={voices} value={c.ai_voice_id} rationale={c.voice_rationale} deliveryHint={c.is_narrator ? "calm, narrative" : undefined} onChange={onVoiceChange} disabled={c.is_excluded} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {c.claimed_by_email ? (
          <span className="rounded-full bg-moss-soft px-2.5 py-0.5 text-xs">Voiced by {c.claimed_by_email}</span>
        ) : null}
        {!c.is_excluded ? (
          <>
            <Button size="sm" variant={c.claimed_by_email ? "ghost" : "secondary"} onClick={() => onClaim(!c.claimed_by_email)}>
              {c.claimed_by_email ? "Release part" : "I'll voice this"}
            </Button>
            <Button size="sm" variant="secondary" onClick={onInvite}>
              Invite a reader
            </Button>
          </>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        {!c.is_narrator ? (
          <>
            {!c.is_excluded ? (
              <Button size="sm" variant="ghost" onClick={onMerge}>
                Merge into…
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onExclude(!c.is_excluded)} title={c.is_excluded ? "Give this character its own voice again" : "Read this character's lines in the narrator's voice"}>
              {c.is_excluded ? "Restore" : "Exclude"}
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
