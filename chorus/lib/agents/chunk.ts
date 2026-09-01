import type { Manuscript } from "@/lib/agents/types";

/** Rough token estimate (~4 chars per token) good enough for chunk sizing. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface Chunk {
  index: number;
  text: string;
  chapter_ids: string[];
  paragraph_ids: string[];
}

/**
 * Splits a manuscript into overlapping windows on paragraph boundaries (§4.2:
 * ~6–8k tokens with ~500 token overlap).
 */
export function chunkManuscript(manuscript: Manuscript, opts: { maxTokens?: number; overlapTokens?: number } = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 7000;
  const overlapTokens = opts.overlapTokens ?? 500;
  const paras = manuscript.chapters.flatMap((ch) => ch.paragraphs.map((p) => ({ ...p, chapter_id: ch.id, tokens: estimateTokens(p.text) })));
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < paras.length) {
    let tokens = 0;
    let j = i;
    while (j < paras.length && (tokens + paras[j].tokens <= maxTokens || j === i)) {
      tokens += paras[j].tokens;
      j++;
    }
    const slice = paras.slice(i, j);
    chunks.push({
      index: chunks.length,
      text: slice.map((p) => p.text).join("\n\n"),
      chapter_ids: [...new Set(slice.map((p) => p.chapter_id))],
      paragraph_ids: slice.map((p) => p.id),
    });
    if (j >= paras.length) break;
    // Step back to create the overlap.
    let back = j;
    let overlap = 0;
    while (back > i + 1 && overlap < overlapTokens) {
      back--;
      overlap += paras[back].tokens;
    }
    i = Math.max(back, i + 1);
  }
  return chunks;
}
