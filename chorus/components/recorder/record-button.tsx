"use client";
import type { RecorderState } from "./use-recorder";

export function RecordButton({ state, onStart, onStop }: { state: RecorderState; onStart: () => void; onStop: () => void }) {
  const recording = state === "recording";
  const disabled = state === "requesting" || state === "unsupported" || state === "denied";
  return (
    <button
      type="button"
      onClick={recording ? onStop : onStart}
      disabled={disabled}
      aria-label={recording ? "Stop recording" : "Start recording"}
      className={`flex h-20 w-20 items-center justify-center rounded-full border-4 transition-colors disabled:opacity-50 ${
        recording ? "border-record bg-record-soft" : "border-ink bg-surface-strong hover:bg-record-soft"
      }`}
    >
      {recording ? <span className="block h-7 w-7 rounded-sm bg-record" /> : <span className="block h-9 w-9 rounded-full bg-record" />}
    </button>
  );
}
