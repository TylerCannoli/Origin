import mammoth from "mammoth";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { detectHeading } from "./chapters";

export interface ParsedDocument {
  /** Raw paragraphs in reading order. */
  paragraphs: string[];
  /** Paragraph indices where a source section (epub spine item) begins. */
  sectionStarts: number[];
  sectionTitles: Record<number, string>;
}

export class ManuscriptParseError extends Error {}

// Built from code points so no invisible characters live in this source file.
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const NARROW_NBSP = String.fromCharCode(0x202f);
const LINE_BREAKS = new RegExp(`[${String.fromCharCode(0x0c)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const HEADING_MARK = String.fromCharCode(1);

export async function parseDocument(kind: string, bytes: Buffer): Promise<ParsedDocument> {
  switch (kind) {
    case "txt":
    case "md":
    case "paste":
      return parseText(bytes.toString("utf8"));
    case "docx":
      return parseDocx(bytes);
    case "epub":
      return parseEpub(bytes);
    case "pdf":
      return parsePdf(bytes);
    default:
      throw new ManuscriptParseError(`Unsupported manuscript type: ${kind}`);
  }
}

export function normalizeText(text: string): string {
  return text
    .split(BOM)
    .join("")
    .replace(/\r\n?/g, "\n")
    .split(NBSP)
    .join(" ")
    .split(NARROW_NBSP)
    .join(" ")
    .replace(LINE_BREAKS, "\n")
    .replace(/\t/g, " ");
}

/** Plain text: blank-line separated paragraphs; hard-wrapped lines are joined. */
export function parseText(raw: string): ParsedDocument {
  const text = normalizeText(raw);
  const hasBlankLines = /\n\s*\n/.test(text);
  let blocks: string[];
  if (hasBlankLines) {
    blocks = text.split(/\n\s*\n+/).map((b) => b.replace(/\s*\n\s*/g, " ").trim());
  } else {
    // No blank lines: treat each non-empty line as a paragraph.
    blocks = text.split("\n").map((l) => l.trim());
  }
  const paragraphs = blocks.filter((b) => b.length > 0);
  return { paragraphs, sectionStarts: [], sectionTitles: {} };
}

async function parseDocx(bytes: Buffer): Promise<ParsedDocument> {
  let result;
  try {
    result = await mammoth.extractRawText({ buffer: bytes });
  } catch (err) {
    throw new ManuscriptParseError(`Could not read the .docx file: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseText(result.value);
}

/** Converts (X)HTML to paragraphs by breaking on block-level elements and stripping tags. */
export function htmlToParagraphs(html: string): { paragraphs: string[]; headings: Set<number> } {
  const withoutScripts = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "");
  const blockBreak = withoutScripts
    .replace(/<\s*(br)\s*\/?>/gi, "\n")
    .replace(/<\s*\/?\s*(p|div|h[1-6]|li|blockquote|section|article|tr|dd|dt|pre|hr|title)\b[^>]*>/gi, (m) => {
      const isHeadingOpen = /^<\s*h[1-6]\b/i.test(m);
      return isHeadingOpen ? `\n\n${HEADING_MARK}` : "\n\n";
    });
  const stripped = blockBreak.replace(/<[^>]+>/g, "");
  const decoded = decodeEntities(stripped);
  const paragraphs: string[] = [];
  const headings = new Set<number>();
  for (const block of decoded.split(/\n\s*\n+/)) {
    let text = block.replace(/\s*\n\s*/g, " ").trim();
    if (!text) continue;
    if (text.includes(HEADING_MARK)) {
      text = text.split(HEADING_MARK).join("").trim();
      if (!text) continue;
      headings.add(paragraphs.length);
    }
    paragraphs.push(text);
  }
  return { paragraphs, headings };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

async function parseEpub(bytes: Buffer): Promise<ParsedDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ManuscriptParseError("The .epub file is not a valid zip archive");
  }
  const container = await zip.file("META-INF/container.xml")?.async("string");
  if (!container) throw new ManuscriptParseError("The .epub file is missing META-INF/container.xml");
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new ManuscriptParseError("The .epub file has no rootfile declaration");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new ManuscriptParseError(`The .epub package file ${opfPath} is missing`);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const type = tag.match(/media-type="([^"]+)"/)?.[1] ?? "";
    if (id && href) manifest.set(id, { href: decodeURIComponent(href), type });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  if (spine.length === 0) throw new ManuscriptParseError("The .epub file has an empty spine");

  const paragraphs: string[] = [];
  const sectionStarts: number[] = [];
  const sectionTitles: Record<number, string> = {};
  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item || !/html|xml/i.test(item.type)) continue;
    const file = zip.file(opfDir + item.href) ?? zip.file(item.href);
    if (!file) continue;
    const html = await file.async("string");
    const { paragraphs: paras, headings } = htmlToParagraphs(html);
    if (paras.length === 0) continue;
    sectionStarts.push(paragraphs.length);
    const firstHeading = [...headings].sort((a, b) => a - b)[0];
    if (firstHeading !== undefined && firstHeading <= 2) sectionTitles[paragraphs.length] = paras[firstHeading];
    paragraphs.push(...paras);
  }
  if (paragraphs.length === 0) throw new ManuscriptParseError("No readable text was found inside the .epub file");
  return { paragraphs, sectionStarts, sectionTitles };
}

async function parsePdf(bytes: Buffer): Promise<ParsedDocument> {
  let pages: string[];
  try {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    const result = await parser.getText();
    pages = result.pages.map((p) => p.text);
    await parser.destroy?.();
  } catch (err) {
    throw new ManuscriptParseError(`Could not read the PDF: ${err instanceof Error ? err.message : String(err)}`);
  }
  return pdfPagesToDocument(pages);
}

/**
 * Cleans page numbers and repeated headers/footers, de-hyphenates, and rebuilds paragraphs from
 * PDF text lines. Extracted PDFs rarely keep blank lines, so paragraph breaks are inferred from
 * chapter headings, short sentence-final lines, and dialogue turn boundaries.
 */
export function pdfPagesToDocument(pages: string[]): ParsedDocument {
  const lineCounts = new Map<string, number>();
  const pageLines = pages.map((p) =>
    normalizeText(p)
      .split("\n")
      .map((l) => l.trim()),
  );
  for (const lines of pageLines) {
    for (const l of new Set(lines.filter((x) => x && x.length < 80))) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
  }
  const repeatedThreshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const isNoise = (l: string) =>
    /^\d{1,4}$/.test(l) || /^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(l) || /^[ivxlc]+$/i.test(l) || (lineCounts.get(l) ?? 0) >= repeatedThreshold;
  const OPEN_QUOTE = /^["\u201c\u2018]/;
  const TURN_BOUNDARY = /(["\u201d][.!?,]?|[.!?]["\u201d])\s+(?=["\u201c])/g;

  const paragraphs: string[] = [];
  let current = "";
  const flush = () => {
    const t = current.trim();
    if (t) {
      // A closing quote followed by an opening quote is a new speaker's paragraph.
      for (const part of t.replace(TURN_BOUNDARY, "$1\n").split("\n")) if (part.trim()) paragraphs.push(part.trim());
    }
    current = "";
  };
  for (const lines of pageLines) {
    const maxLen = Math.max(0, ...lines.map((l) => l.length));
    for (const [i, line] of lines.entries()) {
      if (!line) {
        flush();
        continue;
      }
      if (isNoise(line)) continue;
      if (detectHeading(line)) {
        flush();
        paragraphs.push(line);
        continue;
      }
      if (current.endsWith("-") && /^[a-z]/.test(line)) {
        current = current.slice(0, -1) + line;
      } else {
        current = current ? `${current} ${line}` : line;
      }
      const endsSentence = /[.!?"\u201d\u2019]$/.test(line);
      const next = lines[i + 1] ?? "";
      // Sentence-final line that is clearly short, or that hands over to a quoted line, ends the paragraph.
      if (endsSentence && (line.length < maxLen * 0.85 || OPEN_QUOTE.test(next))) flush();
    }
  }
  flush();
  if (paragraphs.length === 0) throw new ManuscriptParseError("The PDF contains no extractable text (it may be a scanned image)");
  return { paragraphs, sectionStarts: [], sectionTitles: {} };
}
