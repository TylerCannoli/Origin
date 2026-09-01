import type { LLM, LLMRequest, LLMResult } from "@/lib/llm/types";
import { explicitSpeakerName } from "@/lib/agents/dialogue";
import type { AttributionResponse, ChapterSplitResponse, ChunkExtractionResponse, DeliveryNotesResponse, ReconcileResponse, VoiceRationaleResponse } from "@/lib/agents/schemas";

/**
 * Deterministic stand-in for the LLM. Used when CHORUS_LLM_PROVIDER=fake and in tests, so the
 * whole pipeline runs without API keys. Heuristics are intentionally simple; the point is
 * that every agent contract is exercised end to end with schema-valid output.
 */
export class FakeLLM implements LLM {
  public calls: LLMRequest<unknown>[] = [];
  constructor(private readonly overrides: Partial<Record<string, (input: unknown) => unknown>> = {}) {}

  async complete<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    this.calls.push(req as LLMRequest<unknown>);
    const override = this.overrides[req.agent];
    const raw = override ? override(req.input) : defaultFakeResponse(req.agent, req.input);
    const data = req.schema.parse(raw);
    const inputTokens = Math.ceil(JSON.stringify(req.input).length / 4);
    const outputTokens = Math.ceil(JSON.stringify(data).length / 4);
    return { data, model: "fake", inputTokens, outputTokens, latencyMs: 1, costUsd: 0 };
  }
}

export function defaultFakeResponse(agent: string, input: unknown): unknown {
  switch (agent) {
    case "ingestion.chapter_split":
      return chapterSplit(input as { paragraphs: { index: number; preview: string }[] });
    case "character_extraction.chunk":
      return extractChunk(input as { text: string });
    case "character_extraction.reconcile":
      return reconcile(input as { candidates: { name: string; aliases: string[]; descriptions: string[]; mentions: number }[] });
    case "dialogue_attribution.batch":
      return attribute(input as AttributionInput);
    case "script_segmentation.delivery_notes":
      return deliveryNotes(input as { lines: { line_id: string; text: string }[] });
    case "voice_casting.rationale":
      return { rationale: "Chosen to match the character's age impression and tone." } satisfies VoiceRationaleResponse;
    default:
      throw new Error(`FakeLLM has no default for agent ${agent}`);
  }
}

function chapterSplit(input: { paragraphs: { index: number; preview: string }[] }): ChapterSplitResponse {
  const splits: ChapterSplitResponse["splits"] = [];
  for (let i = 0; i < input.paragraphs.length; i += 40) {
    splits.push({ paragraph_index: input.paragraphs[i].index, title: `Part ${splits.length + 1}` });
  }
  return { splits };
}

const NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
const TITLE_WORDS = new Set(["The", "A", "An", "And", "But", "Then", "He", "She", "They", "It", "I", "We", "You", "Chapter", "Old", "Miss", "Mr", "Mrs", "Da", "Below", "Behind", "Morning", "That", "Beside", "There", "If", "Easy", "Nothing", "Drink", "Get", "Suit", "Come", "Every", "Good", "Told", "Your", "Burned"]);

function extractChunk(input: { text: string }): ChunkExtractionResponse {
  const found = new Map<string, { speaks: boolean; count: number }>();
  const paragraphs = input.text.split(/\n\n+/);
  for (const p of paragraphs) {
    const speaker = explicitSpeakerName(p);
    if (speaker) {
      const e = found.get(speaker) ?? { speaks: false, count: 0 };
      e.speaks = true;
      e.count++;
      found.set(speaker, e);
    }
    for (const m of p.matchAll(NAME_RE)) {
      const name = m[1];
      if (TITLE_WORDS.has(name.split(" ")[0])) continue;
      const e = found.get(name) ?? { speaks: false, count: 0 };
      e.count++;
      found.set(name, e);
    }
  }
  const speakingTokens = new Set([...found.entries()].filter(([, v]) => v.speaks).flatMap(([n]) => n.split(" ")));
  const characters = [...found.entries()]
    .filter(([name, v]) => v.speaks || v.count >= 3 || (name.includes(" ") && name.split(" ").some((t) => speakingTokens.has(t))))
    .map(([name, v]) => ({ name, aliases: [], description: `${name} appears in the text.`, speaks: v.speaks }));
  return { characters };
}

function reconcile(input: { candidates: { name: string; aliases: string[]; descriptions: string[]; mentions: number }[] }): ReconcileResponse {
  const remaining = [...input.candidates].sort((a, b) => b.name.length - a.name.length);
  const clusters: { canonical: string; aliases: Set<string>; descriptions: string[] }[] = [];
  for (const c of remaining) {
    const tokens = c.name.split(/\s+/);
    // Bias toward under-merging: only merge a single-token name into exactly one longer name containing it.
    const hosts = tokens.length === 1 ? clusters.filter((cl) => cl.canonical.split(/\s+/).includes(c.name)) : [];
    if (hosts.length === 1) {
      hosts[0].aliases.add(c.name);
      hosts[0].descriptions.push(...c.descriptions);
    } else {
      clusters.push({ canonical: c.name, aliases: new Set(c.aliases), descriptions: [...c.descriptions] });
    }
  }
  return {
    characters: clusters.map((cl) => ({
      canonical_name: cl.canonical,
      aliases: [...cl.aliases],
      blurb: cl.descriptions[0] ?? `${cl.canonical} speaks in this book.`,
      inferred_age_range: null,
      inferred_gender_presentation: null,
      confidence: 0.6,
    })),
  };
}

interface AttributionInput {
  roster: { id: string; canonical_name: string; aliases: string[] }[];
  items: { segment_id: string; paragraph_id: string; quote: string; narration_context: string; before: string; after: string; previous_speakers: (string | null)[] }[];
}

function attribute(input: AttributionInput): AttributionResponse {
  const findByName = (name: string | null) => {
    if (!name) return null;
    const lower = name.toLowerCase();
    return (
      input.roster.find((r) => r.canonical_name.toLowerCase() === lower || r.aliases.some((a) => a.toLowerCase() === lower)) ??
      input.roster.find((r) => r.canonical_name.toLowerCase().split(/\s+/).includes(lower) || r.aliases.some((a) => a.toLowerCase().split(/\s+/).includes(lower))) ??
      null
    );
  };
  const mentioned = (text: string) =>
    input.roster.filter((r) => [r.canonical_name, ...r.aliases].some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)));

  const segments: AttributionResponse["segments"] = [];
  let lastSpeaker: string | null = null;
  let lastParagraph: string | null = null;
  for (const item of input.items) {
    let speaker: string | null = null;
    let confidence = 0.3;
    const explicit = findByName(explicitSpeakerName(item.narration_context));
    if (explicit) {
      speaker = explicit.id;
      confidence = 0.92;
    } else if (item.paragraph_id === lastParagraph && lastSpeaker) {
      speaker = lastSpeaker;
      confidence = 0.85;
    } else {
      const inPara = mentioned(item.narration_context);
      if (inPara.length === 1) {
        speaker = inPara[0].id;
        confidence = 0.75;
      } else {
        const prev = item.previous_speakers.filter(Boolean);
        // Alternating exchange: the speaker two lines back is likely speaking again.
        if (prev.length >= 2 && prev[prev.length - 2] && prev[prev.length - 2] !== prev[prev.length - 1]) {
          speaker = prev[prev.length - 2];
          confidence = 0.62;
        }
      }
    }
    segments.push({ segment_id: item.segment_id, is_dialogue: true, speaker_id: speaker, confidence });
    lastSpeaker = speaker;
    lastParagraph = item.paragraph_id;
  }
  return { segments };
}

function deliveryNotes(input: { lines: { line_id: string; text: string }[] }): DeliveryNotesResponse {
  return {
    notes: input.lines.map((l) => ({
      line_id: l.line_id,
      note: l.text.includes("!") ? "raised, urgent" : l.text.trim().endsWith("?") ? "questioning" : "",
    })),
  };
}
