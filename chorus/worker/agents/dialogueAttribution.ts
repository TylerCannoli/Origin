import type { Sql } from "postgres";
import type { LLM } from "@/lib/llm/types";
import type { AttributedLine, AttributionResult, Manuscript } from "@/lib/agents/types";
import type { CharacterRow } from "@/lib/db/types";
import { splitDialogue } from "@/lib/agents/dialogue";
import { attributionResponse } from "@/lib/agents/schemas";

export interface AttributionDeps {
  sql: Sql;
  llm: LLM;
  onProgress?: (current: number, total: number, message?: string) => Promise<void> | void;
  /** Attributions below this confidence are flagged needs_review (default 0.6). */
  reviewThreshold?: number;
  /** Dialogue segments per LLM call (default 12, roughly 5 paragraphs). */
  batchSize?: number;
}

const SYSTEM = `You attribute dialogue in a novel to its speaker for audiobook casting. You receive quoted spans that were detected mechanically, each with the narration around it, the neighbouring paragraphs, and the speakers of the preceding lines. Decide (1) whether the span is actually spoken dialogue and (2) who speaks it, using the character roster ids. Use speech tags ("said Beth"), pronouns resolved against the surrounding narration, and the turn-taking pattern of the exchange. Give a calibrated confidence: 0.9+ only with an explicit tag or unmistakable context; use null for the speaker rather than guessing when the text does not say.`;

interface Item {
  segment_id: string;
  paragraph_id: string;
  quote: string;
  narration_context: string;
  before: string;
  after: string;
  previous_speakers: (string | null)[];
}

/**
 * Dialogue Attribution Agent (§4.3). Deterministic quote detection splits paragraphs into
 * narration/dialogue segments; only dialogue segments go to the model, in small batches with
 * surrounding context. Output is persisted as manuscripts.attribution.
 */
export async function runDialogueAttribution(deps: AttributionDeps, input: { project_id: string; force?: boolean }): Promise<AttributionResult> {
  const { sql, llm } = deps;
  const threshold = deps.reviewThreshold ?? 0.6;
  const batchSize = deps.batchSize ?? 12;
  const [row] = await sql<{ raw_structure: Manuscript; attribution: AttributionResult | null }[]>`
    select raw_structure, attribution from manuscripts where project_id = ${input.project_id}`;
  if (!row) throw new Error("Ingestion has not run for this project yet");
  if (row.attribution && !input.force) return row.attribution;

  const characters = await sql<CharacterRow[]>`select * from characters where project_id = ${input.project_id} and merged_into_id is null`;
  const narrator = characters.find((c) => c.is_narrator);
  if (!narrator) throw new Error("Character extraction has not run for this project yet");
  const roster = characters.filter((c) => !c.is_narrator).map((c) => ({ id: c.id, canonical_name: c.canonical_name, aliases: c.aliases ?? [] }));

  // 1. Deterministic pre-pass: build every segment, marking dialogue candidates.
  const lines: AttributedLine[] = [];
  const dialogueIndex: number[] = [];
  const items: Item[] = [];
  let lineCounter = 0;
  const lid = () => `line_${String(++lineCounter).padStart(5, "0")}`;

  for (const chapter of row.raw_structure.chapters) {
    const paras = chapter.paragraphs;
    for (let pi = 0; pi < paras.length; pi++) {
      const p = paras[pi];
      const spans = splitDialogue(p.text);
      const narrationContext = spans.filter((s) => s.type === "narration").map((s) => s.text).join(" ");
      spans.forEach((span, order) => {
        const line: AttributedLine = {
          id: lid(),
          chapter_id: chapter.id,
          paragraph_id: p.id,
          order,
          type: span.type,
          speaker_id: span.type === "narration" ? narrator.id : null,
          text: span.text,
          confidence: span.type === "narration" ? 1 : 0,
          needs_review: false,
        };
        lines.push(line);
        if (span.type === "dialogue") {
          dialogueIndex.push(lines.length - 1);
          items.push({
            segment_id: line.id,
            paragraph_id: p.id,
            quote: span.text,
            narration_context: narrationContext,
            before: paras.slice(Math.max(0, pi - 2), pi).map((x) => x.text).join("\n"),
            after: paras.slice(pi + 1, pi + 3).map((x) => x.text).join("\n"),
            previous_speakers: [],
          });
        }
      });
    }
  }

  // 2. Batched LLM attribution with the previous speakers threaded through for turn-taking.
  const byId = new Map(lines.map((l) => [l.id, l]));
  const recentSpeakers: (string | null)[] = [];
  const total = Math.ceil(items.length / batchSize);
  for (let b = 0; b < items.length; b += batchSize) {
    const batch = items.slice(b, b + batchSize);
    for (const item of batch) item.previous_speakers = recentSpeakers.slice(-4);
    await deps.onProgress?.(Math.floor(b / batchSize), total, `Attributing lines ${b + 1}-${Math.min(b + batchSize, items.length)} of ${items.length}`);
    try {
      const { data } = await llm.complete({
        agent: "dialogue_attribution.batch",
        projectId: input.project_id,
        tier: "fast",
        effort: "low",
        system: SYSTEM,
        instruction: "Attribute each quoted segment. Return one entry per segment_id.",
        input: { roster, items: batch },
        schema: attributionResponse,
        maxTokens: 4000,
      });
      const results = new Map(data.segments.map((s) => [s.segment_id, s]));
      for (const item of batch) {
        const line = byId.get(item.segment_id)!;
        const r = results.get(item.segment_id);
        if (!r) {
          line.needs_review = true;
          recentSpeakers.push(null);
          continue;
        }
        if (!r.is_dialogue) {
          line.type = "narration";
          line.speaker_id = narrator.id;
          line.confidence = r.confidence;
          continue;
        }
        const valid = r.speaker_id && roster.some((c) => c.id === r.speaker_id) ? r.speaker_id : null;
        line.confidence = Math.max(0, Math.min(1, r.confidence));
        if (valid && line.confidence >= threshold) {
          line.speaker_id = valid;
          line.needs_review = false;
        } else {
          line.speaker_id = null;
          line.needs_review = true;
        }
        recentSpeakers.push(valid);
      }
    } catch (err) {
      // Degrade gracefully: flag the batch for manual review instead of failing the stage (§4.7).
      console.warn(`[attribute] batch at ${b} failed: ${err instanceof Error ? err.message : err}`);
      for (const item of batch) {
        const line = byId.get(item.segment_id)!;
        line.needs_review = true;
        line.confidence = 0;
        recentSpeakers.push(null);
      }
    }
  }

  const result: AttributionResult = { lines };
  await sql.begin(async (tx) => {
    await tx`update manuscripts set attribution = ${tx.json(result as never)} where project_id = ${input.project_id}`;
    await tx`update chapters set status = 'attributed' where project_id = ${input.project_id} and status = 'pending'`;
  });
  return result;
}
