import { db } from "@/lib/db/client";
import type { ChapterRow, CueRow, RecordingRow } from "@/lib/db/types";

export interface RecordingCue extends CueRow {
  chapter_title: string | null;
  chapter_order: number;
  before_text: string | null;
  after_text: string | null;
  recordings: RecordingRow[];
}

/** Cues for one character grouped by chapter, with all non-rejected recordings attached. */
export async function loadCharacterCues(characterId: string): Promise<{ chapter: ChapterRow; cues: RecordingCue[] }[]> {
  const sql = db();
  const cues = await sql<(CueRow & { chapter_title: string | null; chapter_order: number; before_text: string | null; after_text: string | null })[]>`
    select cu.*, ch.title as chapter_title, ch.order_index as chapter_order,
      (select b.text from cues b where b.chapter_id = cu.chapter_id and b.order_index < cu.order_index order by b.order_index desc limit 1) as before_text,
      (select a.text from cues a where a.chapter_id = cu.chapter_id and a.order_index > cu.order_index order by a.order_index asc limit 1) as after_text
    from cues cu join chapters ch on ch.id = cu.chapter_id
    where cu.character_id = ${characterId} order by ch.order_index, cu.order_index`;
  const ids = cues.map((c) => c.id);
  const recordings = ids.length
    ? await sql<RecordingRow[]>`select * from recordings where cue_id in ${sql(ids)} and status <> 'rejected' order by created_at desc`
    : [];
  const byCue = new Map<string, RecordingRow[]>();
  for (const r of recordings) byCue.set(r.cue_id, [...(byCue.get(r.cue_id) ?? []), r]);
  const chapters = new Map<string, { chapter: ChapterRow; cues: RecordingCue[] }>();
  for (const cue of cues) {
    const entry = chapters.get(cue.chapter_id) ?? {
      chapter: { id: cue.chapter_id, project_id: "", order_index: cue.chapter_order, title: cue.chapter_title, source_chapter_id: null, status: "segmented" },
      cues: [],
    };
    entry.cues.push({ ...cue, recordings: byCue.get(cue.id) ?? [] });
    chapters.set(cue.chapter_id, entry);
  }
  return [...chapters.values()];
}

/** Marks a cue's chapter for re-render when its audio changes (incremental regeneration, §4.6). */
export async function invalidateChapterForCue(cueId: string) {
  await db()`update chapters set status = 'segmented' where status = 'rendered' and id = (select chapter_id from cues where id = ${cueId})`;
}
