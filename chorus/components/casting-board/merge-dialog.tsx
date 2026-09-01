"use client";
import { useState } from "react";
import type { CharacterWithStats } from "@/lib/db/characters";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function MergeDialog({ source, candidates, onClose, onMerge }: { source: CharacterWithStats; candidates: CharacterWithStats[]; onClose: () => void; onMerge: (targetId: string) => Promise<void> }) {
  const [target, setTarget] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Merge ${source.canonical_name}`} onClose={onClose}>
      <p className="text-sm text-ink-soft">
        All {source.line_count} lines move to the character you choose, and “{source.canonical_name}” becomes one of its names. Merging cannot be undone from here, so keep two characters separate if you are unsure.
      </p>
      <div className="mt-4">
        <Label htmlFor="target">Merge into</Label>
        <Select id="target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.canonical_name} ({c.line_count} lines)
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!target || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onMerge(target);
            } finally {
              setBusy(false);
            }
          }}
        >
          Merge characters
        </Button>
      </div>
    </Dialog>
  );
}
