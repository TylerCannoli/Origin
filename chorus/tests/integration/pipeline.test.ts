import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { LocalStorageProvider } from "@/lib/storage";
import { FakeLLM } from "@/lib/llm/fake";
import { LoggedLLM } from "@/lib/llm/logged";
import { runStage } from "@/worker/queues/runner";
import type { WorkerContext } from "@/worker/context";
import type { AttributionResult, CharacterRoster, Manuscript } from "@/lib/agents/types";
import type { Enqueuer } from "@/lib/queue";
import { MockTTS } from "@/lib/tts/mock";
import { FFmpeg } from "@/lib/audio/ffmpeg";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");

let ctx: WorkerContext;
const enqueued: { stage: string; payload: { project_id: string } }[] = [];
const fakeEnqueuer: Enqueuer = {
  async enqueue(stage, payload) {
    enqueued.push({ stage, payload });
    return "job";
  },
};

async function seedProject(kind = "txt", body: string | Buffer = lantern) {
  const sql = db();
  const [user] = await sql`insert into users (id, email) values (gen_random_uuid(), 'owner@example.com') returning id`;
  const [project] = await sql`insert into projects (owner_id, title, rights_attested, status) values (${user.id}, 'The Lantern Keeper', true, 'processing') returning id`;
  const key = `projects/${project.id}/source/manuscript.${kind}`;
  await ctx.storage.put(key, Buffer.isBuffer(body) ? body : Buffer.from(body), "text/plain");
  await sql`update projects set source_file_url = ${key}, source_kind = ${kind} where id = ${project.id}`;
  return project.id as string;
}

beforeAll(async () => {
  await migrateTestDb();
  const sql = db();
  ctx = { sql, storage: new LocalStorageProvider(path.join(os.tmpdir(), "chorus-pipeline-test")), llm: new LoggedLLM(new FakeLLM(), sql, { baseDelayMs: 1 }), enqueuer: fakeEnqueuer, tts: new MockTTS(), ffmpeg: new FFmpeg() };
});
beforeEach(async () => {
  await resetTestDb();
  enqueued.length = 0;
});
afterAll(async () => {
  await closeDb();
});

describe("character pipeline (ingest -> extract -> attribute)", () => {
  it("runs each stage, persists outputs, and chains the next stage", async () => {
    const projectId = await seedProject();
    const sql = db();

    await runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true });
    const [m] = await sql<{ raw_structure: Manuscript; word_count: number }[]>`select raw_structure, word_count from manuscripts where project_id = ${projectId}`;
    expect(m.raw_structure.chapters).toHaveLength(3);
    expect(m.word_count).toBeGreaterThan(400);
    const chapters = await sql`select title, order_index, status from chapters where project_id = ${projectId} order by order_index`;
    expect(chapters.map((c) => c.title)).toEqual(["Chapter 1: The Storm", "Chapter 2: The Gull", "Chapter 3: Noon"]);
    expect(enqueued.at(-1)).toEqual({ stage: "extract_characters", payload: { project_id: projectId, force: undefined } });
    const runs = await sql`select stage, status from pipeline_runs where project_id = ${projectId} order by created_at`;
    expect(runs).toEqual([
      { stage: "ingest", status: "complete" },
      { stage: "extract_characters", status: "queued" },
    ]);

    await runStage(ctx, "extract_characters", { project_id: projectId }, { finalAttempt: true });
    const characters = await sql<{ canonical_name: string; is_narrator: boolean; aliases: string[] }[]>`select canonical_name, is_narrator, aliases from characters where project_id = ${projectId} order by is_narrator desc, canonical_name`;
    const names = characters.map((c) => c.canonical_name);
    expect(names).toContain("Narrator");
    expect(names).toContain("Mara Quill");
    expect(names).toContain("Tobias Quill");
    expect(names).toContain("Fen");
    expect(names).toContain("Ida Brand");
    expect(characters.find((c) => c.canonical_name === "Mara Quill")?.aliases).toContain("Mara");
    const [{ extraction }] = await sql<{ extraction: CharacterRoster }[]>`select extraction from manuscripts where project_id = ${projectId}`;
    expect(extraction.narrator.id).toBe("char_narrator");
    expect(extraction.characters[0].id).toBe("char_001");
    expect(enqueued.at(-1)?.stage).toBe("attribute_dialogue");

    await runStage(ctx, "attribute_dialogue", { project_id: projectId }, { finalAttempt: true });
    const [{ attribution }] = await sql<{ attribution: AttributionResult }[]>`select attribution from manuscripts where project_id = ${projectId}`;
    const lines = attribution.lines;
    expect(lines.length).toBeGreaterThan(30);
    expect(lines[0].id).toBe("line_00001");
    const byName = Object.fromEntries(characters.map((c) => [c.canonical_name, c]));
    const idOf = async (name: string) => (await sql`select id from characters where project_id = ${projectId} and canonical_name = ${name}`)[0].id;
    const mara = await idOf("Mara Quill");
    const tobias = await idOf("Tobias Quill");
    const first = lines.find((l) => l.text.startsWith("You'll burn through the oil"));
    expect(first?.type).toBe("dialogue");
    expect(first?.speaker_id).toBe(tobias);
    const second = lines.find((l) => l.text.startsWith("Then I'll burn through it"));
    expect(second?.speaker_id).toBe(mara);
    // The narration part of a mixed paragraph is a separate narrator segment with the same paragraph id.
    const tag = lines.find((l) => l.text === "Mara said.");
    expect(tag).toMatchObject({ type: "narration", paragraph_id: second?.paragraph_id, speaker_id: byName["Narrator"] ? expect.any(String) : null });
    expect(lines.filter((l) => l.type === "dialogue").every((l) => l.needs_review || l.speaker_id)).toBe(true);
    const statuses = await sql`select distinct status from chapters where project_id = ${projectId}`;
    expect(statuses).toEqual([{ status: "attributed" }]);
    expect(enqueued.at(-1)?.stage).toBe("segment_script");

    const agentRuns = await sql`select agent_name, status from agent_runs where project_id = ${projectId}`;
    expect(agentRuns.length).toBeGreaterThan(3);
    expect(agentRuns.every((r) => r.status === "ok")).toBe(true);
  });

  it("is idempotent without force and re-runs with force", async () => {
    const projectId = await seedProject();
    const sql = db();
    await runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true });
    const [{ id: firstId }] = await sql`select id from manuscripts where project_id = ${projectId}`;
    await runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true });
    const [{ id: sameId }] = await sql`select id from manuscripts where project_id = ${projectId}`;
    expect(sameId).toBe(firstId);
    await runStage(ctx, "ingest", { project_id: projectId, force: true }, { finalAttempt: true });
    const [{ id: newId }] = await sql`select id from manuscripts where project_id = ${projectId}`;
    expect(newId).not.toBe(firstId);
  });

  it("records a failed run and marks the project on the final attempt", async () => {
    const projectId = await seedProject("txt", "too short");
    const sql = db();
    await expect(runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: false })).rejects.toThrow(/too short/);
    let [run] = await sql`select status, error from pipeline_runs where project_id = ${projectId}`;
    expect(run.status).toBe("queued");
    await expect(runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true })).rejects.toThrow(/too short/);
    [run] = await sql`select status, error from pipeline_runs where project_id = ${projectId}`;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/too short/);
    const [p] = await sql`select status from projects where id = ${projectId}`;
    expect(p.status).toBe("error");
    expect(enqueued).toHaveLength(0);
  });

  it("flags unattributable lines for review instead of guessing", async () => {
    const text = "Chapter 1\n\n\"Who goes there?\"\n\n\"Nobody you know.\"\n\n\"State your business.\"";
    const projectId = await seedProject("txt", `${text}\n\n${"Filler sentence about the night. ".repeat(10)}`);
    const sql = db();
    await runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true });
    await runStage(ctx, "extract_characters", { project_id: projectId }, { finalAttempt: true });
    await runStage(ctx, "attribute_dialogue", { project_id: projectId }, { finalAttempt: true });
    const [{ attribution }] = await sql<{ attribution: AttributionResult }[]>`select attribution from manuscripts where project_id = ${projectId}`;
    const dialogue = attribution.lines.filter((l) => l.type === "dialogue");
    expect(dialogue.length).toBe(3);
    expect(dialogue.every((l) => l.needs_review && l.speaker_id === null)).toBe(true);
  });
});
