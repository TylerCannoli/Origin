import { db } from "@/lib/db/client";
import { storage } from "@/lib/storage";
import type { ChapterRow, RenderedAudioRow } from "@/lib/db/types";

export interface AudioListing {
  chapters: { chapter: ChapterRow; render: (RenderedAudioRow & { url: string }) | null; stale: boolean }[];
  book: { mp3: (RenderedAudioRow & { url: string }) | null; m4b: (RenderedAudioRow & { url: string }) | null };
  total_duration_ms: number;
}

/** Rendered audio for a project with short-lived signed URLs. */
export async function listAudio(projectId: string, expiresInSeconds = 3600): Promise<AudioListing> {
  const sql = db();
  const store = storage();
  const chapters = await sql<ChapterRow[]>`select * from chapters where project_id = ${projectId} order by order_index`;
  const renders = await sql<RenderedAudioRow[]>`select * from rendered_audio where project_id = ${projectId} order by rendered_at desc`;
  const sign = async (r: RenderedAudioRow) => ({ ...r, url: await store.signedUrl(r.audio_url, expiresInSeconds) });
  const chapterEntries = [];
  for (const chapter of chapters) {
    const r = renders.find((x) => x.scope === "chapter" && x.chapter_id === chapter.id);
    chapterEntries.push({ chapter, render: r ? await sign(r) : null, stale: chapter.status !== "rendered" || !r });
  }
  const mp3 = renders.find((r) => r.scope === "full_book" && r.format === "mp3");
  const m4b = renders.find((r) => r.scope === "full_book" && r.format === "m4b");
  return {
    chapters: chapterEntries,
    book: { mp3: mp3 ? await sign(mp3) : null, m4b: m4b ? await sign(m4b) : null },
    total_duration_ms: chapterEntries.reduce((n, c) => n + (c.render?.duration_ms ?? 0), 0),
  };
}
