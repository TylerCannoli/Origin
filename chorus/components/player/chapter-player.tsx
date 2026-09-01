"use client";
import { useEffect, useRef, useState } from "react";
import { Wave } from "@/components/ui/wave";

export interface PlayerChapter {
  title: string | null;
  order_index: number;
  url: string;
  duration_ms: number | null;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Audiobook player: plays chapter files back to back with a chapter list. Uses per-chapter
 * MP3s (rather than the combined file) so seeking to a chapter is instant.
 */
export function ChapterPlayer({ chapters, title }: { chapters: PlayerChapter[]; title: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [rate, setRate] = useState(1);
  const current = chapters[index];

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = rate;
  }, [rate, index]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    el.src = current.url;
    el.load();
    if (playing) el.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!current) return null;
  const total = chapters.reduce((n, c) => n + (c.duration_ms ?? 0), 0);

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-muted">{title}</div>
          <div className="truncate text-2xl display">{current.title ?? `Chapter ${current.order_index + 1}`}</div>
        </div>
        <Wave bars={14} live={playing} className="text-gold" />
      </div>
      <audio
        ref={audioRef}
        preload="metadata"
        className="mt-4 w-full"
        controls
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
        onEnded={() => {
          if (index < chapters.length - 1) setIndex(index + 1);
          else setPlaying(false);
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          {fmt(position)} / {fmt(current.duration_ms ?? 0)}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-2">
          Speed
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded border border-line bg-surface-strong px-2 py-1">
            {[0.8, 1, 1.2, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>
        <span>{fmt(total)} total</span>
      </div>
      <ol className="mt-4 divide-y divide-line">
        {chapters.map((c, i) => (
          <li key={c.url}>
            <button
              type="button"
              onClick={() => {
                setIndex(i);
                setPlaying(true);
              }}
              className={`flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm hover:bg-surface-strong ${i === index ? "bg-surface-strong font-medium" : ""}`}
            >
              <span className="truncate">
                {i + 1}. {c.title ?? `Chapter ${c.order_index + 1}`}
              </span>
              <span className="shrink-0 text-muted">{fmt(c.duration_ms ?? 0)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
