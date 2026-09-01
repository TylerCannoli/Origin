"use client";
import { useState } from "react";
import type { CharacterWithStats } from "@/lib/db/characters";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function EditCharacterDialog({ character: c, onClose, onSave }: { character: CharacterWithStats; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(c.canonical_name);
  const [aliases, setAliases] = useState((c.aliases ?? []).join(", "));
  const [blurb, setBlurb] = useState(c.blurb ?? "");
  const [age, setAge] = useState(c.inferred_age_range ?? "");
  const [gender, setGender] = useState(c.inferred_gender_presentation ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={c.is_narrator ? "Edit narrator" : "Edit character"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              ...(c.is_narrator ? {} : { canonical_name: name.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean) }),
              blurb: blurb.trim() || null,
              inferred_age_range: age || null,
              inferred_gender_presentation: gender || null,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {!c.is_narrator ? (
          <>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="aliases" hint="Comma separated. Helps readers recognise the part.">
                Also known as
              </Label>
              <Input id="aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
            </div>
          </>
        ) : null}
        <div>
          <Label htmlFor="blurb" hint="Shown to whoever records this part.">
            Voice notes
          </Label>
          <Textarea id="blurb" rows={3} value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={600} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="age" hint="Only used to suggest a default AI voice.">
              Age impression
            </Label>
            <Select id="age" value={age} onChange={(e) => setAge(e.target.value)}>
              <option value="">Not sure</option>
              {["child", "teen", "young_adult", "adult", "middle_aged", "elderly"].map((a) => (
                <option key={a} value={a}>
                  {a.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="gender" hint="Only used to suggest a default AI voice.">
              Voice presentation
            </Label>
            <Select id="gender" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Not sure</option>
              <option value="female">female</option>
              <option value="male">male</option>
              <option value="neutral">neutral</option>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
