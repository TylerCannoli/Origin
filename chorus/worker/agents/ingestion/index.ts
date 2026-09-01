import type { Sql } from "postgres";
import type { LLM } from "@/lib/llm/types";
import type { StorageProvider } from "@/lib/storage";
import type { Manuscript, ManuscriptChapter } from "@/lib/agents/types";
import { MAX_MANUSCRIPT_WORDS } from "@/lib/validation/schemas";
import { parseDocument, ManuscriptParseError, type ParsedDocument } from "./parsers";
import { detectChapters, proposeChaptersWithLLM, type ChapterBoundary } from "./chapters";

export { ManuscriptParseError };

export const LLM_CHAPTER_FALLBACK_MIN_WORDS = 8000;
const HARD_SPLIT_WORDS = 4000;

export const countWords = (text: string) => (text.match(/\S+/g) ?? []).length;

/**
 * Builds the normalized Manuscript (section 4.1 output contract) from parsed paragraphs and
 * chapter boundaries. Pure function; exported for tests.
 */
export function buildManuscript(doc: ParsedDocument, boundaries: ChapterBoundary[], fallbackTitle: string): Manuscript {
  const paras = doc.paragraphs;
  const chapters: ManuscriptChapter[] = [];
  let pCounter = 0;
  const pid = () => `p_${String(++pCounter).padStart(4, "0")}`;
  const cid = () => `ch_${String(chapters.length + 1).padStart(3, "0")}`;

  const sorted = [...boundaries].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) {
    chapters.push({ id: cid(), title: fallbackTitle, paragraphs: paras.map((text) => ({ id: pid(), text })) });
    return { chapters };
  }
  // Front matter before the first heading: keep it only if it is substantial (a title page is dropped).
  const front = paras.slice(0, sorted[0].index);
  if (countWords(front.join(" ")) > 60) {
    chapters.push({ id: cid(), title: "Front matter", paragraphs: front.map((text) => ({ id: pid(), text })) });
  }
  sorted.forEach((b, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].index : paras.length;
    const body = paras.slice(b.index + b.headingParagraphs, end);
    if (body.length === 0) return;
    chapters.push({ id: cid(), title: b.title, paragraphs: body.map((text) => ({ id: pid(), text })) });
  });
  return { chapters };
}

/** Hard split for very long single chapters when neither heuristics nor the LLM found breaks. */
function hardSplit(doc: ParsedDocument): ChapterBoundary[] {
  const boundaries: ChapterBoundary[] = [];
  let words = 0;
  doc.paragraphs.forEach((p, i) => {
    if (i === 0 || words >= HARD_SPLIT_WORDS) {
      boundaries.push({ index: i, title: `Part ${boundaries.length + 1}`, headingParagraphs: 0 });
      words = 0;
    }
    words += countWords(p);
  });
  return boundaries;
}

export interface IngestionDeps {
  sql: Sql;
  llm: LLM;
  storage: StorageProvider;
}

export interface IngestionResult {
  manuscript: Manuscript;
  wordCount: number;
  chapterCount: number;
  usedLLMForChapters: boolean;
}

/**
 * Ingestion Agent (section 4.1): file -> clean, structured manuscript. Persists
 * manuscripts.raw_structure and creates chapter rows. Idempotent: returns the stored
 * manuscript when one already exists unless force is set.
 */
export async function runIngestion(deps: IngestionDeps, input: { project_id: string; force?: boolean }): Promise<IngestionResult> {
  const { sql, storage, llm } = deps;
  const [project] = await sql<{ id: string; title: string; source_file_url: string | null; source_kind: string | null }[]>`
    select id, title, source_file_url, source_kind from projects where id = ${input.project_id}`;
  if (!project) throw new Error(`Project ${input.project_id} not found`);
  if (!project.source_file_url) throw new ManuscriptParseError("No manuscript has been uploaded for this project");

  if (!input.force) {
    const [existing] = await sql<{ raw_structure: Manuscript; word_count: number }[]>`select raw_structure, word_count from manuscripts where project_id = ${project.id}`;
    if (existing) {
      return { manuscript: existing.raw_structure, wordCount: existing.word_count, chapterCount: existing.raw_structure.chapters.length, usedLLMForChapters: false };
    }
  }

  const bytes = await storage.get(project.source_file_url);
  const doc = await parseDocument(project.source_kind ?? "txt", bytes);
  const wordCount = countWords(doc.paragraphs.join(" "));
  if (wordCount < 20) throw new ManuscriptParseError("The manuscript is empty or too short to process (fewer than 20 words)");
  if (wordCount > MAX_MANUSCRIPT_WORDS) {
    throw new ManuscriptParseError(`The manuscript is too long (${wordCount.toLocaleString()} words; the limit is ${MAX_MANUSCRIPT_WORDS.toLocaleString()})`);
  }

  let boundaries = detectChapters(doc);
  let usedLLM = false;
  if (boundaries.length === 0 && wordCount > LLM_CHAPTER_FALLBACK_MIN_WORDS) {
    boundaries = await proposeChaptersWithLLM(llm, project.id, doc.paragraphs);
    usedLLM = true;
    if (boundaries.length === 0) boundaries = hardSplit(doc);
  }
  const manuscript = buildManuscript(doc, boundaries, project.title || "Chapter 1");
  if (manuscript.chapters.length === 0) throw new ManuscriptParseError("No readable chapters were found in the manuscript");

  await sql.begin(async (tx) => {
    await tx`delete from chapters where project_id = ${project.id}`;
    await tx`delete from manuscripts where project_id = ${project.id}`;
    await tx`insert into manuscripts (project_id, raw_structure, word_count) values (${project.id}, ${tx.json(manuscript as never)}, ${wordCount})`;
    for (const [i, ch] of manuscript.chapters.entries()) {
      await tx`insert into chapters (project_id, order_index, title, source_chapter_id, status) values (${project.id}, ${i}, ${ch.title}, ${ch.id}, 'pending')`;
    }
  });

  return { manuscript, wordCount, chapterCount: manuscript.chapters.length, usedLLMForChapters: usedLLM };
}
