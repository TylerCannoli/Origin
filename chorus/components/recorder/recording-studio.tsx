"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RecordingCue } from "@/lib/db/recordings";
import type { ChapterRow, RecordingRow } from "@/lib/db/types";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useRecorder } from "./use-recorder";
import { WaveformPreview } from "./waveform-preview";
import { RecordButton } from "./record-button";
import { TakeList } from "./take-list";

type StudioCue = RecordingCue & { recorded_by_others?: boolean };
export interface StudioData {
  project: { id: string; title: string };
  invite: { scope: "character" | "project"; expires_at: string | null };
  character: { id: string; canonical_name: string; aliases: string[]; blurb: string | null; is_narrator: boolean };
  chapters: { chapter: ChapterRow; cues: StudioCue[] }[];
  progress: { recorded: number; total: number };
  viewer: { id: string; email: string | null } | null;
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The recording interface: one line at a time, record / listen / re-record / save, auto-advance. */
export function RecordingStudio({ token, initial, characterQuery }: { token: string; initial: StudioData; characterQuery: string }) {
  const [data, setData] = useState(initial);
  const flat = useMemo(() => data.chapters.flatMap((ch) => ch.cues.map((c) => ({ ...c, chapter: ch.chapter }))), [data]);
  const firstUnrecorded = flat.findIndex((c) => c.recordings.length === 0);
  const [index, setIndex] = useState(firstUnrecorded === -1 ? 0 : firstUnrecorded);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const rec = useRecorder();
  const current = flat[index];

  const reload = useCallback(async () => {
    const next = await api.get<StudioData>(`/api/record/${token}${characterQuery}`);
    setData(next);
  }, [token, characterQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (rec.state === "recording") rec.stop();
        else if (rec.state === "idle" || rec.state === "stopped") rec.start();
      }
      if (e.key === "ArrowRight") setIndex((i) => Math.min(flat.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rec, flat.length]);

  async function save() {
    if (!rec.take || !current) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      const ext = rec.take.mimeType.includes("mp4") ? "m4a" : rec.take.mimeType.includes("ogg") ? "ogg" : "webm";
      form.append("file", new File([rec.take.blob], `take.${ext}`, { type: rec.take.mimeType }));
      form.append("duration_ms", String(rec.take.durationMs));
      await api.post<{ recording: RecordingRow }>(`/api/record/${token}/cues/${current.id}`, form);
      rec.discard();
      await reload();
      setMessage({ tone: "success", text: "Saved." });
      if (autoAdvance) {
        const nextIdx = flat.findIndex((c, i) => i > index && c.recordings.length === 0);
        if (nextIdx !== -1) setIndex(nextIdx);
      }
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Upload failed. Your take is still here; try saving again." });
    } finally {
      setUploading(false);
    }
  }

  async function deleteTake(id: string) {
    try {
      await api.delete(`/api/recordings/${id}?token=${encodeURIComponent(token)}`);
      await reload();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not delete take" });
    }
  }

  if (flat.length === 0) {
    return <Notice tone="info">This character has no lines yet. Check back once the project owner has finished setting up the script.</Notice>;
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_18rem]">
      <div className="space-y-6">
        <header>
          <div className="text-sm text-muted">{data.project.title}</div>
          <h1 className="text-4xl">{data.character.canonical_name}</h1>
          {data.character.blurb ? <p className="mt-2 max-w-prose text-ink-soft">{data.character.blurb}</p> : null}
          <p className="mt-2 text-sm text-muted">
            {data.progress.recorded} of {data.progress.total} lines recorded
          </p>
        </header>

        {rec.state === "unsupported" ? <Notice tone="error">This browser cannot record audio. Try the latest Chrome, Safari or Firefox.</Notice> : null}
        {rec.error ? <Notice tone="error">{rec.error}</Notice> : null}

        {current ? (
          <section className="rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center justify-between text-sm text-muted">
              <span>
                {current.chapter.title ?? `Chapter ${current.chapter.order_index + 1}`} · line {index + 1} of {flat.length}
              </span>
              {current.recordings.length > 0 ? <span className="rounded-full bg-moss-soft px-2 py-0.5 text-xs text-ink">recorded</span> : null}
            </div>
            {current.before_text ? <p className="mt-4 text-sm text-muted">…{current.before_text.slice(-140)}</p> : null}
            <p className="script-text mt-3 text-2xl">{current.type === "dialogue" ? `“${current.text}”` : current.text}</p>
            {current.delivery_note ? <p className="mt-2 text-sm italic text-ink-soft">Direction: {current.delivery_note}</p> : null}
            {current.after_text ? <p className="mt-3 text-sm text-muted">{current.after_text.slice(0, 140)}…</p> : null}

            <div className="mt-6 rounded-md border border-line bg-surface-strong p-3">
              <WaveformPreview analyser={rec.analyser} active={rec.state === "recording"} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <RecordButton state={rec.state} onStart={rec.start} onStop={rec.stop} />
              <div className="flex-1 text-sm">
                {rec.state === "recording" ? (
                  <span className="flex items-center gap-2">
                    <span className="recording-dot" /> Recording {fmt(rec.elapsedMs)}
                  </span>
                ) : rec.state === "stopped" && rec.take ? (
                  <span>Take ready ({fmt(rec.take.durationMs)}). Listen, then save or record again.</span>
                ) : (
                  <span className="text-muted">Press the button or the space bar to record. Speak the line, then press again to stop.</span>
                )}
              </div>
            </div>

            {rec.take ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <audio controls src={rec.take.url} className="h-9 flex-1" />
                <Button variant="secondary" onClick={rec.discard} disabled={uploading}>
                  Record again
                </Button>
                <Button onClick={save} disabled={uploading}>
                  {uploading ? "Saving" : "Save take"}
                </Button>
              </div>
            ) : null}

            {message ? (
              <div className="mt-4">
                <Notice tone={message.tone}>{message.text}</Notice>
              </div>
            ) : null}

            {current.recordings.length > 0 ? (
              <div className="mt-5">
                <div className="mb-2 text-sm text-muted">Your takes</div>
                <TakeList recordings={current.recordings} token={token} onDelete={deleteTake} />
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex items-center justify-between">
          <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            Previous line
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
            Jump to the next unrecorded line after saving
          </label>
          <Button variant="secondary" onClick={() => setIndex((i) => Math.min(flat.length - 1, i + 1))} disabled={index === flat.length - 1}>
            Next line
          </Button>
        </div>

        {!data.viewer ? (
          <Notice tone="info">
            Recording as a guest. Your takes are saved to this project already.{" "}
            <Link href={`/login?claim=${encodeURIComponent(token)}`} className="underline">
              Create a free account
            </Link>{" "}
            to keep them under your name and come back to them later.
          </Notice>
        ) : null}
      </div>

      <aside className="md:sticky md:top-6 md:self-start">
        <div className="text-sm text-muted">All lines</div>
        <ol className="mt-2 max-h-[70vh] space-y-1 overflow-y-auto pr-1 text-sm">
          {flat.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-surface ${i === index ? "bg-surface-strong ring-1 ring-line-strong" : ""}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.recordings.length > 0 ? "bg-moss" : c.recorded_by_others ? "bg-gold" : "bg-line-strong"}`} />
                <span className="line-clamp-2 text-ink-soft">{c.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
