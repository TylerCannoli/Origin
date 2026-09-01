import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseDocument, ManuscriptParseError } from "@/worker/agents/ingestion/parsers";
import { detectChapters } from "@/worker/agents/ingestion/chapters";

async function makeEpub(sections: { title: string; paragraphs: string[]; heading?: boolean }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const manifest = sections.map((_, i) => `<item id="s${i}" href="s${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = sections.map((_, i) => `<itemref idref="s${i}"/>`).join("");
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package><manifest>${manifest}<item id="css" href="style.css" media-type="text/css"/></manifest><spine>${spine}</spine></package>`);
  sections.forEach((s, i) => {
    const body = `${s.heading === false ? "" : `<h2>${s.title}</h2>`}${s.paragraphs.map((p) => `<p>${p}</p>`).join("")}`;
    zip.file(`OEBPS/s${i}.xhtml`, `<html><head><title>x</title><style>p{}</style></head><body>${body}</body></html>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("epub ingestion", () => {
  it("reads spine items in order, flags headings, and decodes entities", async () => {
    const epub = await makeEpub([
      { title: "Chapter 1", paragraphs: ["It was a dark &amp; stormy night.", "&ldquo;Hello,&rdquo; said Tom."] },
      { title: "Chapter 2", paragraphs: ["Morning came."] },
    ]);
    const doc = await parseDocument("epub", epub);
    expect(doc.paragraphs).toEqual(["Chapter 1", "It was a dark & stormy night.", "“Hello,” said Tom.", "Chapter 2", "Morning came."]);
    expect(doc.sectionStarts).toEqual([0, 3]);
    const chapters = detectChapters(doc);
    expect(chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });
  it("falls back to spine sections when headings are not chapter-like", async () => {
    const epub = await makeEpub([
      { title: "The Storm", paragraphs: ["Text one."] },
      { title: "The Gull", paragraphs: ["Text two."] },
    ]);
    const doc = await parseDocument("epub", epub);
    const chapters = detectChapters(doc);
    expect(chapters.map((c) => c.title)).toEqual(["The Storm", "The Gull"]);
    expect(chapters[0].headingParagraphs).toBe(1);
  });
  it("rejects malformed epubs with a clear message", async () => {
    await expect(parseDocument("epub", Buffer.from("not a zip"))).rejects.toThrow(ManuscriptParseError);
    await expect(parseDocument("epub", Buffer.from("not a zip"))).rejects.toThrow(/not a valid zip/);
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    const noContainer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseDocument("epub", noContainer)).rejects.toThrow(/container.xml/);
    zip.file("META-INF/container.xml", `<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`);
    zip.file("book.opf", `<package><manifest></manifest><spine></spine></package>`);
    const emptySpine = await zip.generateAsync({ type: "nodebuffer" });
    await expect(parseDocument("epub", emptySpine)).rejects.toThrow(/empty spine/);
  });
  it("rejects unsupported kinds", async () => {
    await expect(parseDocument("exe", Buffer.from("x"))).rejects.toThrow(/Unsupported/);
  });
});
