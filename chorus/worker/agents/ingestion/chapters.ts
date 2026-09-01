import type { LLM } from "@/lib/llm/types";
import { chapterSplitResponse } from "@/lib/agents/schemas";
import type { ParsedDocument } from "./parsers";

export interface ChapterBoundary {
  /** Paragraph index that starts the chapter (the heading paragraph itself, if any). */
  index: number;
  title: string;
  /** Number of leading paragraphs (heading + optional subtitle) that are not body text. */
  headingParagraphs: number;
}

const ROMAN = "(?:[ivxlcdm]+)";
const NUMBER_WORDS =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|[a-z]+-[a-z]+)";
const DASHES = "—–";
const HEADING_RE = new RegExp(
  `^(?:#{1,3}\\s+)?(?:(?:chapter|part|book|act|canto|letter|scene)\\s+(?:\\d+|${ROMAN}|${NUMBER_WORDS})\\b[\\s.:\\-${DASHES}]*(.*)|(prologue|epilogue|interlude|preface|introduction|afterword|foreword)\\b[\\s.:\\-${DASHES}]*(.*))$`,
  "i",
);
const BARE_NUMBER_RE = new RegExp(`^(?:\\d{1,3}|${ROMAN})\\.?$`, "i");
const MARKDOWN_RE = /^#{1,3}\s+(.+)$/;
const TRAILING_PUNCT_RE = new RegExp(`[.:\\-${DASHES}\\s]+$`);
const SUBTITLE_SEP_RE = new RegExp(`[:${DASHES}]\\s*\\S`);

export function detectHeading(paragraph: string): { title: string } | null {
  const text = paragraph.trim();
  if (text.length > 90) return null;
  const md = text.match(MARKDOWN_RE);
  if (md) return { title: md[1].trim() };
  if (HEADING_RE.test(text)) {
    const label = text.replace(/^#{1,3}\s+/, "").replace(TRAILING_PUNCT_RE, "");
    return { title: label.replace(/\s+/g, " ") };
  }
  if (BARE_NUMBER_RE.test(text)) return { title: `Chapter ${text.replace(/\.$/, "").toUpperCase()}` };
  return null;
}

function looksLikeSubtitle(text: string | undefined): boolean {
  if (!text) return false;
  return text.length <= 70 && !/[.!?"”]$/.test(text) && !detectHeading(text) && /^[A-Z“"']/.test(text) && text.split(/\s+/).length <= 10;
}

/** Heuristic chapter detection (section 4.1 step 3). Returns boundaries sorted by paragraph index. */
export function detectChapters(doc: ParsedDocument): ChapterBoundary[] {
  const boundaries: ChapterBoundary[] = [];
  const paras = doc.paragraphs;
  for (let i = 0; i < paras.length; i++) {
    const h = detectHeading(paras[i]);
    if (!h) continue;
    let title = h.title;
    let headingParagraphs = 1;
    if (!SUBTITLE_SEP_RE.test(title) && looksLikeSubtitle(paras[i + 1])) {
      title = `${title}: ${paras[i + 1].trim()}`;
      headingParagraphs = 2;
    }
    boundaries.push({ index: i, title, headingParagraphs });
    i += headingParagraphs - 1;
  }
  // Fall back to epub section boundaries when no textual headings were found.
  if (boundaries.length === 0 && doc.sectionStarts.length > 1) {
    doc.sectionStarts.forEach((start, n) => {
      const sectionTitle = doc.sectionTitles[start];
      boundaries.push({ index: start, title: sectionTitle ?? `Section ${n + 1}`, headingParagraphs: sectionTitle !== undefined ? 1 : 0 });
    });
  }
  return boundaries;
}

/** LLM fallback for long manuscripts with no detectable chapter breaks. */
export async function proposeChaptersWithLLM(llm: LLM, projectId: string, paragraphs: string[]): Promise<ChapterBoundary[]> {
  const boundaries: ChapterBoundary[] = [];
  const WINDOW = 600;
  for (let start = 0; start < paragraphs.length; start += WINDOW) {
    const window = paragraphs.slice(start, start + WINDOW).map((p, i) => ({ index: start + i, preview: p.slice(0, 100) }));
    const { data } = await llm.complete({
      agent: "ingestion.chapter_split",
      projectId,
      tier: "strong",
      effort: "medium",
      system:
        "You are an editor preparing a manuscript for audiobook production. The manuscript has no explicit chapter headings. Propose natural chapter break points (scene or time shifts, changes of viewpoint) so chapters are roughly 1,500-5,000 words each. Only return paragraph indices that appear in the input.",
      instruction: "Propose chapter splits for these paragraphs (index + preview). Give each new chapter a short, plain title based on its content.",
      input: { paragraphs: window },
      schema: chapterSplitResponse,
    });
    for (const s of data.splits) {
      if (s.paragraph_index >= start && s.paragraph_index < start + WINDOW) {
        boundaries.push({ index: s.paragraph_index, title: s.title.trim() || `Part ${boundaries.length + 1}`, headingParagraphs: 0 });
      }
    }
  }
  return boundaries.sort((a, b) => a.index - b.index).filter((b, i, arr) => i === 0 || b.index !== arr[i - 1].index);
}
