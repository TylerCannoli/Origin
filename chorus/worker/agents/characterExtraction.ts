import type { Sql } from "postgres";
import type { LLM } from "@/lib/llm/types";
import type { CharacterRoster, ExtractedCharacter, Manuscript } from "@/lib/agents/types";
import { chunkManuscript } from "@/lib/agents/chunk";
import { chunkExtractionResponse, reconcileResponse } from "@/lib/agents/schemas";

export interface ExtractionDeps {
  sql: Sql;
  llm: LLM;
  onProgress?: (current: number, total: number, message?: string) => Promise<void> | void;
}

interface Candidate {
  name: string;
  aliases: Set<string>;
  descriptions: string[];
  mentions: number;
  speaks: boolean;
  snippets: string[];
}

const CHUNK_SYSTEM = `You are a casting assistant reading a manuscript for audiobook production. Your job is to list the characters who appear in a chunk of text, especially those who speak. Use only what the text says. Report names exactly as written. Group nicknames and titles that clearly refer to the same person within this chunk as aliases. Do not invent characters, and do not include groups ("the crowd") unless they speak as a unit.`;

const RECONCILE_SYSTEM = `You are a casting director consolidating a character list gathered from separate sections of a manuscript. Cluster entries that refer to the same person (e.g. "Beth", "Elizabeth", "Beth March"). Prefer leaving two entries separate over merging them wrongly: only merge when the evidence is clear. For each character write a 1-2 sentence blurb describing voice-relevant traits (age impression, tone, formality, accent hints only if the text states them). Set inferred_age_range and inferred_gender_presentation only when the text gives a clear signal; otherwise use null. They are only used to pre-select a default synthetic voice and the user can change them.`;

function normalizeName(n: string) {
  return n.trim().replace(/\s+/g, " ").replace(/^(the|a|an)\s+/i, "");
}

/** Merges per-chunk extractions by exact (case-insensitive) name. Exported for tests. */
export function mergeCandidates(chunks: { characters: { name: string; aliases: string[]; description: string; speaks: boolean }[]; snippet: string }[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const chunk of chunks) {
    for (const c of chunk.characters) {
      const name = normalizeName(c.name);
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = map.get(key) ?? { name, aliases: new Set<string>(), descriptions: [], mentions: 0, speaks: false, snippets: [] };
      entry.mentions++;
      entry.speaks ||= c.speaks;
      for (const a of c.aliases) {
        const alias = normalizeName(a);
        if (alias && alias.toLowerCase() !== key) entry.aliases.add(alias);
      }
      if (c.description && entry.descriptions.length < 4) entry.descriptions.push(c.description);
      if (entry.snippets.length < 2) entry.snippets.push(chunk.snippet);
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

/**
 * Character Extraction Agent (§4.2): chunked extraction + reconciliation pass -> roster.
 * Persists manuscripts.extraction and (re)creates character rows. Only speaking characters
 * are kept; everyone else is narrated by the Narrator.
 */
export async function runCharacterExtraction(deps: ExtractionDeps, input: { project_id: string; force?: boolean }): Promise<CharacterRoster> {
  const { sql, llm } = deps;
  const [row] = await sql<{ raw_structure: Manuscript; extraction: CharacterRoster | null }[]>`
    select raw_structure, extraction from manuscripts where project_id = ${input.project_id}`;
  if (!row) throw new Error("Ingestion has not run for this project yet");
  if (row.extraction && !input.force) return row.extraction;

  const chunks = chunkManuscript(row.raw_structure);
  const perChunk: { characters: { name: string; aliases: string[]; description: string; speaks: boolean }[]; snippet: string }[] = [];
  let lastError: unknown = null;
  for (const chunk of chunks) {
    await deps.onProgress?.(chunk.index, chunks.length, `Reading section ${chunk.index + 1} of ${chunks.length}`);
    try {
      const { data } = await llm.complete({
        agent: "character_extraction.chunk",
        projectId: input.project_id,
        tier: "strong",
        effort: "medium",
        system: CHUNK_SYSTEM,
        instruction: "List the characters in this chunk of the manuscript.",
        input: { chunk_index: chunk.index, of: chunks.length, text: chunk.text },
        schema: chunkExtractionResponse,
      });
      perChunk.push({ characters: data.characters, snippet: chunk.text.slice(0, 400) });
    } catch (err) {
      // Degrade gracefully (§4.7): a failed chunk loses its candidates but does not fail the stage.
      lastError = err;
      console.warn(`[extract] chunk ${chunk.index} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Every chunk failing is not degradation, it is an outage (bad key, provider down): surface it.
  if (chunks.length > 0 && perChunk.length === 0) {
    throw new Error(`Character extraction failed for every section: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  // Non-speaking mentions are kept through reconciliation so full names used only in
  // narration ("Elizabeth March") can be merged with the speaking short form ("Beth").
  const candidates = mergeCandidates(perChunk);
  const speakingNames = new Set(candidates.filter((c) => c.speaks).flatMap((c) => [c.name, ...c.aliases]).map((n) => n.toLowerCase()));
  await deps.onProgress?.(chunks.length, chunks.length, "Reconciling names");

  let reconciled: ExtractedCharacter[] = [];
  if (candidates.length > 0) {
    const BATCH = 100;
    const sortedCandidates = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < sortedCandidates.length; i += BATCH) {
      const batch = sortedCandidates.slice(i, i + BATCH);
      const { data } = await llm.complete({
        agent: "character_extraction.reconcile",
        projectId: input.project_id,
        tier: "strong",
        effort: "high",
        system: RECONCILE_SYSTEM,
        instruction: "Consolidate these candidate characters into a canonical roster.",
        input: {
          candidates: batch.map((c) => ({ name: c.name, aliases: [...c.aliases], descriptions: c.descriptions, mentions: c.mentions, speaks: c.speaks, context: c.snippets })),
        },
        schema: reconcileResponse,
      });
      for (const c of data.characters) {
        const name = normalizeName(c.canonical_name);
        if (!name) continue;
        reconciled.push({
          id: "",
          canonical_name: name,
          aliases: [...new Set(c.aliases.map(normalizeName).filter((a) => a && a.toLowerCase() !== name.toLowerCase()))],
          blurb: c.blurb.trim(),
          inferred_age_range: c.inferred_age_range,
          inferred_gender_presentation: c.inferred_gender_presentation,
          confidence: Math.max(0, Math.min(1, c.confidence)),
        });
      }
    }
  }
  // Keep only characters with spoken lines (everyone else is narrated), and dedupe on canonical name.
  const seen = new Set<string>();
  reconciled = reconciled.filter((c) => {
    const k = c.canonical_name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return [c.canonical_name, ...c.aliases].some((n) => speakingNames.has(n.toLowerCase()));
  });
  reconciled.forEach((c, i) => (c.id = `char_${String(i + 1).padStart(3, "0")}`));

  const roster: CharacterRoster = { characters: reconciled, narrator: { id: "char_narrator", canonical_name: "Narrator" } };

  await sql.begin(async (tx) => {
    await tx`delete from characters where project_id = ${input.project_id}`;
    await tx`insert into characters (project_id, canonical_name, is_narrator, blurb) values (${input.project_id}, 'Narrator', true, 'Reads all narration between the dialogue.')`;
    for (const c of reconciled) {
      await tx`insert into characters ${tx({
        project_id: input.project_id,
        canonical_name: c.canonical_name,
        aliases: c.aliases,
        blurb: c.blurb,
        inferred_age_range: c.inferred_age_range,
        inferred_gender_presentation: c.inferred_gender_presentation,
        confidence: c.confidence,
      })}`;
    }
    await tx`update manuscripts set extraction = ${tx.json(roster as never)} where project_id = ${input.project_id}`;
  });
  return roster;
}
