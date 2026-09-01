import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseText, htmlToParagraphs, pdfPagesToDocument, decodeEntities } from "@/worker/agents/ingestion/parsers";
import { detectChapters, detectHeading } from "@/worker/agents/ingestion/chapters";
import { buildManuscript, countWords } from "@/worker/agents/ingestion";
import { chunkManuscript } from "@/lib/agents/chunk";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");

describe("ingestion parsing", () => {
  it("splits plain text into paragraphs and joins hard-wrapped lines", () => {
    const doc = parseText("Line one\ncontinues here.\n\nSecond paragraph.\n\n\n\nThird.");
    expect(doc.paragraphs).toEqual(["Line one continues here.", "Second paragraph.", "Third."]);
  });
  it("treats single-newline text as one paragraph per line", () => {
    expect(parseText("A\nB\nC").paragraphs).toEqual(["A", "B", "C"]);
  });
  it("converts html to paragraphs and flags headings", () => {
    const { paragraphs, headings } = htmlToParagraphs("<html><body><h1>Chapter One</h1><p>First &amp; <i>second</i>.</p><p>Third&nbsp;line.</p></body></html>");
    expect(paragraphs).toEqual(["Chapter One", "First & second.", "Third line."]);
    expect([...headings]).toEqual([0]);
  });
  it("decodes entities", () => {
    expect(decodeEntities("&ldquo;Hi&rdquo; &#8212; &#x27;x&#x27;")).toBe("“Hi” — 'x'");
  });
  it("cleans pdf page numbers and repeated headers and de-hyphenates", () => {
    const pages = [
      "THE LANTERN KEEPER\nThe storm came in off the water an hour before dusk, and by the time the first gust rat-\ntled the shutters, Mara had lit every lamp.\n12",
      "THE LANTERN KEEPER\nMorning brought a grey calm.\n13",
      "THE LANTERN KEEPER\nThey saw the sail at noon.\n14",
    ];
    const doc = pdfPagesToDocument(pages);
    expect(doc.paragraphs.join(" | ")).not.toContain("THE LANTERN KEEPER");
    expect(doc.paragraphs.join(" | ")).not.toMatch(/\b1[234]\b/);
    expect(doc.paragraphs[0]).toContain("rattled the shutters");
  });
});

describe("chapter detection", () => {
  it("recognises common heading forms", () => {
    expect(detectHeading("Chapter 1: The Storm")?.title).toBe("Chapter 1: The Storm");
    expect(detectHeading("CHAPTER XII")?.title).toBe("CHAPTER XII");
    expect(detectHeading("# Prologue")?.title).toBe("Prologue");
    expect(detectHeading("Part Two")?.title).toBe("Part Two");
    expect(detectHeading("7")?.title).toBe("Chapter 7");
    expect(detectHeading("He walked to the chapter house.")).toBeNull();
    expect(detectHeading("Chapter after chapter of misery followed, and the book was long enough that nobody finished it.")).toBeNull();
  });
  it("attaches a subtitle line to a bare heading", () => {
    const doc = parseText("Chapter 1\n\nThe Storm\n\nIt was dark.\n\nChapter 2\n\nIt was light.");
    const b = detectChapters(doc);
    expect(b.map((x) => [x.index, x.title, x.headingParagraphs])).toEqual([
      [0, "Chapter 1: The Storm", 2],
      [3, "Chapter 2", 1],
    ]);
  });
  it("builds the manuscript contract from the fixture", () => {
    const doc = parseText(lantern);
    const boundaries = detectChapters(doc);
    expect(boundaries).toHaveLength(3);
    const m = buildManuscript(doc, boundaries, "fallback");
    expect(m.chapters.map((c) => c.title)).toEqual(["Chapter 1: The Storm", "Chapter 2: The Gull", "Chapter 3: Noon"]);
    expect(m.chapters[0].id).toBe("ch_001");
    expect(m.chapters[0].paragraphs[0].id).toBe("p_0001");
    expect(m.chapters[0].paragraphs[0].text).toMatch(/^The storm came in/);
    // The title line before the first chapter is dropped as front matter.
    expect(m.chapters.flatMap((c) => c.paragraphs).some((p) => p.text === "The Lantern Keeper")).toBe(false);
    expect(countWords(lantern)).toBeGreaterThan(400);
  });
  it("keeps substantial front matter as its own chapter", () => {
    const front = Array.from({ length: 10 }, (_, i) => `Front paragraph number ${i} with enough words to count toward the threshold here.`).join("\n\n");
    const doc = parseText(`${front}\n\nChapter 1\n\nBody.`);
    const m = buildManuscript(doc, detectChapters(doc), "x");
    expect(m.chapters[0].title).toBe("Front matter");
    expect(m.chapters[1].title).toBe("Chapter 1");
  });
});

describe("chunkManuscript", () => {
  it("creates overlapping windows on paragraph boundaries", () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => ({ id: `p_${i}`, text: `Paragraph ${i} `.repeat(40) }));
    const chunks = chunkManuscript({ chapters: [{ id: "ch_001", title: "One", paragraphs }] }, { maxTokens: 1000, overlapTokens: 200 });
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 1; i < chunks.length; i++) {
      const prev = new Set(chunks[i - 1].paragraph_ids);
      expect(chunks[i].paragraph_ids.some((id) => prev.has(id))).toBe(true);
    }
    const all = new Set(chunks.flatMap((c) => c.paragraph_ids));
    expect(all.size).toBe(50);
  });
});
