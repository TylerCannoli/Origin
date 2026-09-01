import type { Sql } from "postgres";
import type { LLM } from "@/lib/llm/types";
import type { AttributionResult, AttributedLine, ChapterScript, Manuscript } from "@/lib/agents/types";
import type { CharacterRow, ChapterRow } from "@/lib/db/types";
import { deliveryNotesResponse } from "@/lib/agents/schemas";

export interface SegmentationDeps {
  sql: Sql;
  llm: LLM;
  onProgress?: (current: number, total: number, message?: string) => Promise<void> | void;
}

/** Speech verbs and manner adverbs -> short delivery notes (deterministic, §4.4). */
const VERB_NOTES: [RegExp, string][] = [
  [/\bwhisper(ed|s|ing)?\b/i, "whispered"],
  [/\bmutter(ed|s|ing)?\b|\bmumbl(ed|es|ing)\b/i, "muttered, under the breath"],
  [/\bsnap(ped|s)\b/i, "sharp, snapping"],
  [/\bhiss(ed|es)\b/i, "hissed, low and sharp"],
  [/\bshout(ed|s)\b|\byell(ed|s)\b|\bbellow(ed|s)\b|\broar(ed|s)\b/i, "shouted"],
  [/\bscream(ed|s)\b|\bshriek(ed|s)\b/i, "screamed"],
  [/\bcried\b|\bcries\b|\bexclaim(ed|s)\b/i, "cried out, urgent"],
  [/\bcall(ed|s)\b/i, "called across a distance"],
  [/\bgasp(ed|s)\b/i, "gasping, breathless"],
  [/\bsigh(ed|s)\b/i, "with a sigh"],
  [/\blaugh(ed|s|ing)\b|\bchuckl(ed|es)\b|\bgiggl(ed|es)\b/i, "laughing"],
  [/\bgrowl(ed|s)\b|\bgrumbl(ed|es)\b|\bgrunt(ed|s)\b/i, "gruff, growling"],
  [/\bsob(bed|s)\b|\bweep(s|ing)?\b|\bwept\b/i, "through tears"],
  [/\bstammer(ed|s)\b|\bstutter(ed|s)\b/i, "stammering, unsure"],
  [/\bplead(ed|s)\b|\bbeg(ged|s)\b/i, "pleading"],
  [/\bdemand(ed|s)\b|\border(ed|s)\b|\bcommand(ed|s)\b/i, "demanding, firm"],
  [/\bsneer(ed|s)\b|\bscoff(ed|s)\b/i, "sneering, contemptuous"],
  [/\bdrawl(ed|s)\b/i, "slow drawl"],
  [/\bbreath(ed|es)\b|\bmurmur(ed|s)\b/i, "soft, breathy"],
  [/\bsang\b|\bsing(s|ing)\b|\bhum(med|s)\b/i, "sung"],
  [/\bwarn(ed|s)\b/i, "warning, serious"],
  [/\bteas(ed|es|ing)\b|\bgrin(ned|s)\b/i, "teasing, light"],
  [/\bcoldly\b|\bicily\b/i, "cold"],
  [/\bsoftly\b|\bgently\b|\bquietly\b|\btenderly\b/i, "soft, gentle"],
  [/\bsharply\b|\bcurtly\b|\bbriskly\b/i, "sharp, curt"],
  [/\bangrily\b|\bfuriously\b|\bhotly\b/i, "angry"],
  [/\bsadly\b|\bmournfully\b|\bwearily\b/i, "sad, weary"],
  [/\bcheerfully\b|\bbrightly\b|\bhappily\b|\beagerly\b/i, "bright, cheerful"],
  [/\bnervously\b|\banxiously\b|\bhesitantly\b/i, "nervous, hesitant"],
  [/\bfirmly\b|\bflatly\b|\bevenly\b/i, "flat, firm"],
  [/\bslowly\b|\bcarefully\b|\bdeliberately\b/i, "slow, deliberate"],
  [/\bdryly\b|\bsarcastically\b|\bwryly\b/i, "dry, sarcastic"],
  [/\bfrantically\b|\bdesperately\b|\burgently\b/i, "frantic, urgent"],
];

/** Derives a delivery note from the narration adjacent to a dialogue line in the same paragraph. Exported for tests. */
export function deliveryNoteFromNarration(narration: string): string | null {
  for (const [re, note] of VERB_NOTES) if (re.test(narration)) return note;
  return null;
}

/**
 * Script Segmentation Agent (§4.4): attributed lines -> per-chapter cue lists with delivery
 * notes. Persists cues (replacing any previous ones for the project) and marks chapters segmented.
 */
export async function runScriptSegmentation(deps: SegmentationDeps, input: { project_id: string; force?: boolean }): Promise<ChapterScript[]> {
  const { sql, llm } = deps;
  const [m] = await sql<{ raw_structure: Manuscript; attribution: AttributionResult | null }[]>`
    select raw_structure, attribution from manuscripts where project_id = ${input.project_id}`;
  if (!m?.attribution) throw new Error("Dialogue attribution has not run for this project yet");

  const [{ count: existing }] = await sql<{ count: number }[]>`
    select count(*)::int as count from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${input.project_id}`;
  const chapters = await sql<ChapterRow[]>`select * from chapters where project_id = ${input.project_id} order by order_index`;
  const characters = await sql<CharacterRow[]>`select * from characters where project_id = ${input.project_id}`;
  const narrator = characters.find((c) => c.is_narrator);
  if (!narrator) throw new Error("No narrator character exists for this project");
  const resolveCharacter = (id: string | null): string => {
    if (!id) return narrator.id;
    let c = characters.find((x) => x.id === id);
    let hops = 0;
    while (c?.merged_into_id && hops++ < 10) c = characters.find((x) => x.id === c!.merged_into_id);
    return c ? c.id : narrator.id;
  };

  if (existing > 0 && !input.force) {
    return loadScript(sql, chapters);
  }

  // Delivery notes: deterministic from adjacent narration; LLM only for lines with no explicit cue.
  const lines = m.attribution.lines;
  const byParagraph = new Map<string, AttributedLine[]>();
  for (const l of lines) {
    const arr = byParagraph.get(l.paragraph_id) ?? [];
    arr.push(l);
    byParagraph.set(l.paragraph_id, arr);
  }
  const notes = new Map<string, string | null>();
  const needsInference: { line_id: string; text: string; context: string }[] = [];
  for (const l of lines) {
    if (l.type !== "dialogue") continue;
    const narration = (byParagraph.get(l.paragraph_id) ?? []).filter((x) => x.type === "narration").map((x) => x.text).join(" ");
    const note = deliveryNoteFromNarration(narration);
    if (note) notes.set(l.id, note);
    else needsInference.push({ line_id: l.id, text: l.text, context: narration.slice(0, 200) });
  }
  const BATCH = 40;
  const total = Math.ceil(needsInference.length / BATCH);
  for (let i = 0; i < needsInference.length; i += BATCH) {
    const batch = needsInference.slice(i, i + BATCH);
    await deps.onProgress?.(Math.floor(i / BATCH), total, `Writing delivery notes ${i + 1}-${Math.min(i + BATCH, needsInference.length)} of ${needsInference.length}`);
    try {
      const { data } = await llm.complete({
        agent: "script_segmentation.delivery_notes",
        projectId: input.project_id,
        tier: "fast",
        effort: "low",
        maxTokens: 4000,
        system:
          "You are a dialogue director annotating an audiobook script. For each line give at most six words of delivery direction inferred from the line and its context (e.g. 'urgent, almost pleading' or 'flat, sarcastic'). Return an empty note when the line is plain and needs no direction. Never rewrite the line.",
        instruction: "Write a delivery note for each line.",
        input: { lines: batch },
        schema: deliveryNotesResponse,
      });
      for (const n of data.notes) {
        const note = n.note.trim().split(/\s+/).slice(0, 6).join(" ");
        if (note) notes.set(n.line_id, note);
      }
    } catch (err) {
      console.warn(`[segment] delivery-note batch at ${i} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Build and persist cues.
  const scripts: ChapterScript[] = [];
  await sql.begin(async (tx) => {
    await tx`delete from cues where chapter_id in (select id from chapters where project_id = ${input.project_id})`;
    let cueCounter = 0;
    for (const chapter of chapters) {
      const chapterLines = lines.filter((l) => l.chapter_id === chapter.source_chapter_id);
      const script: ChapterScript = { chapter_id: chapter.id, cues: [] };
      for (const [order, l] of chapterLines.entries()) {
        const characterId = l.type === "narration" ? narrator.id : resolveCharacter(l.speaker_id);
        const note = l.type === "dialogue" ? (notes.get(l.id) ?? null) : null;
        const [row] = await tx<{ id: string }[]>`insert into cues ${tx({
          chapter_id: chapter.id,
          character_id: characterId,
          order_index: order,
          type: l.type,
          text: l.text,
          delivery_note: note,
          confidence: l.confidence,
          needs_review: l.needs_review,
          paragraph_id: l.paragraph_id,
        })} returning id`;
        cueCounter++;
        script.cues.push({ cue_id: row.id, type: l.type, text: l.text, character_id: characterId, delivery_note: note, paragraph_id: l.paragraph_id, confidence: l.confidence, needs_review: l.needs_review });
      }
      await tx`update chapters set status = 'segmented' where id = ${chapter.id}`;
      scripts.push(script);
    }
    void cueCounter;
  });
  return scripts;
}

async function loadScript(sql: Sql, chapters: ChapterRow[]): Promise<ChapterScript[]> {
  const out: ChapterScript[] = [];
  for (const ch of chapters) {
    const cues = await sql<{ id: string; type: "narration" | "dialogue"; text: string; character_id: string; delivery_note: string | null; paragraph_id: string | null; confidence: number | null; needs_review: boolean }[]>`
      select id, type, text, character_id, delivery_note, paragraph_id, confidence, needs_review from cues where chapter_id = ${ch.id} order by order_index`;
    out.push({ chapter_id: ch.id, cues: cues.map((c) => ({ cue_id: c.id, type: c.type, text: c.text, character_id: c.character_id, delivery_note: c.delivery_note, paragraph_id: c.paragraph_id ?? undefined, confidence: c.confidence ?? undefined, needs_review: c.needs_review })) });
  }
  return out;
}
