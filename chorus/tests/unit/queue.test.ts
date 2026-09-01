import { describe, expect, it } from "vitest";
import { jobIdFor, nextStage } from "@/lib/queue";

describe("queue helpers", () => {
  it("builds BullMQ-safe deterministic job ids", () => {
    const id = jobIdFor("render_chapter", { project_id: "p:1", chapter_id: "c1", batch_id: "b1" });
    expect(id).toBe("render_chapter_p-1_c1_b1");
    expect(id).not.toContain(":");
    expect(jobIdFor("ingest", { project_id: "p" })).toBe("ingest_p");
  });
  it("chains processing stages and stops after casting", () => {
    expect(nextStage("ingest")).toBe("extract_characters");
    expect(nextStage("cast_voices")).toBeNull();
    expect(nextStage("render_chapter")).toBeNull();
  });
});
