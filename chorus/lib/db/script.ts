import { db } from "@/lib/db/client";
import type { ChapterRow, CueRow } from "@/lib/db/types";

export interface ScriptCueRow extends CueRow {
  character_name: string;
  is_narrator: boolean;
  has_recording: boolean;
  recording_status: string | null;
}

export interface ScriptChapter {
  chapter: ChapterRow;
  cues: ScriptCueRow[];
}

/** Full cue list grouped by chapter, with speaker names and recording state. */
export async function loadScript(projectId: string): Promise<ScriptChapter[]> {
  const sql = db();
  const chapters = await sql<ChapterRow[]>`select * from chapters where project_id = ${projectId} order by order_index`;
  const cues = await sql<ScriptCueRow[]>`
    select cu.*, c.canonical_name as character_name, c.is_narrator,
      exists (select 1 from recordings r where r.cue_id = cu.id and r.status <> 'rejected') as has_recording,
      (select r.status from recordings r where r.cue_id = cu.id and r.status <> 'rejected' order by (r.status = 'approved') desc, r.created_at desc limit 1) as recording_status
    from cues cu join characters c on c.id = cu.character_id join chapters ch on ch.id = cu.chapter_id
    where ch.project_id = ${projectId} order by ch.order_index, cu.order_index`;
  const byChapter = new Map<string, ScriptCueRow[]>();
  for (const cue of cues) {
    const arr = byChapter.get(cue.chapter_id) ?? [];
    arr.push(cue);
    byChapter.set(cue.chapter_id, arr);
  }
  return chapters.map((chapter) => ({ chapter, cues: byChapter.get(chapter.id) ?? [] }));
}

export interface ReviewCue extends ScriptCueRow {
  chapter_title: string | null;
  before_text: string | null;
  after_text: string | null;
}

/** Cues flagged needs_review with one neighbouring cue of context on each side. */
export async function loadReviewQueue(projectId: string): Promise<ReviewCue[]> {
  return db()<ReviewCue[]>`
    select cu.*, c.canonical_name as character_name, c.is_narrator, ch.title as chapter_title, false as has_recording, null as recording_status,
      (select text from cues b where b.chapter_id = cu.chapter_id and b.order_index < cu.order_index order by b.order_index desc limit 1) as before_text,
      (select text from cues a where a.chapter_id = cu.chapter_id and a.order_index > cu.order_index order by a.order_index asc limit 1) as after_text
    from cues cu join characters c on c.id = cu.character_id join chapters ch on ch.id = cu.chapter_id
    where ch.project_id = ${projectId} and cu.needs_review
    order by ch.order_index, cu.order_index`;
}
