import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { LocalStorageProvider } from "@/lib/storage";
import { FakeLLM, defaultFakeResponse } from "@/lib/llm/fake";
import { LoggedLLM } from "@/lib/llm/logged";
import { MockTTS } from "@/lib/tts/mock";
import { FFmpeg } from "@/lib/audio/ffmpeg";
import { runStage } from "@/worker/queues/runner";
import "@/worker/queues/register";
import type { WorkerContext } from "@/worker/context";
import type { AttributionResult } from "@/lib/agents/types";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");

function makeCtx(llm: FakeLLM): WorkerContext {
  const sql = db();
  return { sql, storage: new LocalStorageProvider(path.join(os.tmpdir(), "chorus-degrade-test")), llm: new LoggedLLM(llm, sql, { baseDelayMs: 1, maxAttempts: 2 }), enqueuer: { enqueue: async () => "job" }, tts: new MockTTS(), ffmpeg: new FFmpeg() };
}

async function seed(ctx: WorkerContext) {
  const sql = db();
  const [user] = await sql`insert into users (id, email) values (gen_random_uuid(), 'o@example.com') returning id`;
  const [project] = await sql`insert into projects (owner_id, title, rights_attested, status) values (${user.id}, 'T', true, 'processing') returning id`;
  const key = `projects/${project.id}/source/manuscript.txt`;
  await ctx.storage.put(key, Buffer.from(lantern), "text/plain");
  await sql`update projects set source_file_url = ${key}, source_kind = 'txt' where id = ${project.id}`;
  return project.id as string;
}

beforeAll(migrateTestDb);
beforeEach(resetTestDb);
afterAll(closeDb);

describe("LLM failure handling (§4.7)", () => {
  it("fails the stage with the provider error when every call fails", async () => {
    const llm = new FakeLLM({
      "character_extraction.chunk": () => {
        throw new Error("Could not resolve authentication method");
      },
    });
    const ctx = makeCtx(llm);
    const projectId = await seed(ctx);
    await runStage(ctx, "ingest", { project_id: projectId }, { finalAttempt: true });
    await expect(runStage(ctx, "extract_characters", { project_id: projectId }, { finalAttempt: true })).rejects.toThrow(/every section: Could not resolve authentication/);
    const [run] = await db()`select status, error from pipeline_runs where project_id = ${projectId} and stage = 'extract_characters'`;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/authentication/);
    const errors = await db()`select count(*)::int as n from agent_runs where project_id = ${projectId} and status = 'error'`;
    expect(errors[0].n).toBeGreaterThan(0);
  });

  it("flags lines for review when only some attribution batches fail", async () => {
    let calls = 0;
    const llm = new FakeLLM({
      "dialogue_attribution.batch": (input) => {
        calls++;
        if (calls === 1) throw new Error("rate limited");
        // Second call onward: delegate to the default heuristics.
        return defaultFakeResponse("dialogue_attribution.batch", input);
      },
    });
    const ctx = makeCtx(llm);
    const projectId = await seed(ctx);
    for (const stage of ["ingest", "extract_characters"] as const) await runStage(ctx, stage, { project_id: projectId }, { finalAttempt: true });
    await runStage(ctx, "attribute_dialogue", { project_id: projectId }, { finalAttempt: true });
    const [{ attribution }] = await db()<{ attribution: AttributionResult }[]>`select attribution from manuscripts where project_id = ${projectId}`;
    const dialogue = attribution.lines.filter((l) => l.type === "dialogue");
    const flagged = dialogue.filter((l) => l.needs_review);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.length).toBeLessThan(dialogue.length);
    const [run] = await db()`select status from pipeline_runs where project_id = ${projectId} and stage = 'attribute_dialogue'`;
    expect(run.status).toBe("complete");
  });
});
