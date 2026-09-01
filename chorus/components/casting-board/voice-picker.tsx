"use client";
import { useEffect, useRef, useState } from "react";
import type { Voice } from "@/lib/tts/types";
import { api } from "@/lib/api/client";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Wave } from "@/components/ui/wave";

export function VoicePicker({
  voices,
  value,
  rationale,
  deliveryHint,
  disabled,
  onChange,
}: {
  voices: Voice[];
  value: string | null;
  rationale?: string | null;
  deliveryHint?: string;
  disabled?: boolean;
  onChange: (voiceId: string) => void;
}) {
  const [selected, setSelected] = useState(value ?? "");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => setSelected(value ?? ""), [value]);

  async function audition() {
    if (!selected) return;
    setError(null);
    try {
      audioRef.current?.pause();
      setPlaying(true);
      const { url } = await api.post<{ url: string }>("/api/voices/audition", { voice_id: selected, delivery_note: deliveryHint });
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => {
        setPlaying(false);
        setError("Could not play the preview");
      };
      await audio.play();
    } catch (err) {
      setPlaying(false);
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  const current = voices.find((v) => v.id === (value ?? ""));
  return (
    <div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted shrink-0">AI voice</label>
        <Select
          value={selected}
          disabled={disabled || voices.length === 0}
          onChange={(e) => {
            setSelected(e.target.value);
            if (e.target.value && e.target.value !== value) onChange(e.target.value);
          }}
          className="text-sm"
        >
          {!value ? <option value="">Choose a voice</option> : null}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.gender || v.age ? ` (${[v.gender, v.age?.replace("_", " ")].filter(Boolean).join(", ")})` : ""}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" type="button" onClick={audition} disabled={!selected || disabled} title="Play a short sample in this voice">
          {playing ? <Wave bars={5} live className="text-gold" /> : "Listen"}
        </Button>
      </div>
      {current?.descriptors?.length ? <p className="mt-1 text-xs text-muted">{current.descriptors.slice(0, 5).join(", ")}</p> : null}
      {rationale ? <p className="mt-1 text-xs text-ink-soft">{rationale}</p> : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
