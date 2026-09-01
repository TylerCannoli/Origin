import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { ctx, jsonRequest } from "../helpers/request";
import { __setEnqueuerForTests } from "@/lib/queue";
import { __setStorageForTests, LocalStorageProvider } from "@/lib/storage";
import os from "node:os";
import path from "node:path";
import { POST as createProject, GET as listProjects } from "@/app/api/projects/route";
import { DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { POST as inviteProject, GET as listInvites } from "@/app/api/projects/[id]/invite/route";
import { DELETE as revokeInvite } from "@/app/api/invites/[id]/route";
import { GET as getRecordSession } from "@/app/api/record/[token]/route";
import { GET as costs } from "@/app/api/projects/[id]/costs/route";
import { POST as retry } from "@/app/api/projects/[id]/pipeline/retry/route";

const OWNER = "owner@example.com";
let storage: LocalStorageProvider;

beforeAll(async () => {
  await migrateTestDb();
  storage = new LocalStorageProvider(path.join(os.tmpdir(), "chorus-hardening-test"));
  __setStorageForTests(storage);
  __setEnqueuerForTests({ enqueue: async () => "job" });
});
beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeDb();
});

describe("hardening", () => {
  it("records analytics and exposes a cost report to the owner only", async () => {
    const { project } = await (await createProject(jsonRequest("/api/projects", "POST", { title: "T" }, OWNER), ctx({}))).json();
    const sql = db();
    await sql`insert into agent_runs (project_id, agent_name, model, input_tokens, output_tokens, latency_ms, estimated_cost_usd, status) values
      (${project.id}, 'dialogue_attribution.batch', 'claude-sonnet-5', 1000, 200, 900, 0.004, 'ok'),
      (${project.id}, 'dialogue_attribution.batch', 'claude-sonnet-5', 1000, 200, 1100, 0.004, 'error')`;
    const report = await (await costs(jsonRequest(`/api/projects/${project.id}/costs`, "GET", undefined, OWNER), ctx({ id: project.id }))).json();
    expect(report.total_calls).toBe(2);
    expect(report.total_errors).toBe(1);
    expect(report.total_usd).toBeCloseTo(0.008, 5);
    expect(report.by_agent[0]).toMatchObject({ agent_name: "dialogue_attribution.batch", calls: 2, input_tokens: 2000 });
    expect(report.activity.find((a: { event: string }) => a.event === "project_created")?.count).toBe(1);
    const other = await costs(jsonRequest(`/api/projects/${project.id}/costs`, "GET", undefined, "x@example.com"), ctx({ id: project.id }));
    expect(other.status).toBe(403);
  });

  it("lists and revokes casting links", async () => {
    const { project } = await (await createProject(jsonRequest("/api/projects", "POST", { title: "T" }, OWNER), ctx({}))).json();
    const { invite, link } = await (await inviteProject(jsonRequest(`/api/projects/${project.id}/invite`, "POST", {}, OWNER), ctx({ id: project.id }))).json();
    const token = link.split("/record/")[1];
    const listed = await (await listInvites(jsonRequest(`/api/projects/${project.id}/invite`, "GET", undefined, OWNER), ctx({ id: project.id }))).json();
    expect(listed.invites).toHaveLength(1);
    const stranger = await revokeInvite(jsonRequest(`/api/invites/${invite.id}`, "DELETE", undefined, "x@example.com"), ctx({ id: invite.id }));
    expect(stranger.status).toBe(403);
    const revoked = await revokeInvite(jsonRequest(`/api/invites/${invite.id}`, "DELETE", undefined, OWNER), ctx({ id: invite.id }));
    expect(revoked.status).toBe(200);
    const after = await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }));
    expect(after.status).toBe(410);
    const listedAfter = await (await listInvites(jsonRequest(`/api/projects/${project.id}/invite`, "GET", undefined, OWNER), ctx({ id: project.id }))).json();
    expect(listedAfter.invites).toHaveLength(0);
  });

  it("removes stored files when a project is deleted", async () => {
    const { project } = await (await createProject(jsonRequest("/api/projects", "POST", { title: "T" }, OWNER), ctx({}))).json();
    const key = `projects/${project.id}/source/manuscript.txt`;
    await storage.put(key, Buffer.from("hello"), "text/plain");
    expect(await storage.exists(key)).toBe(true);
    await deleteProject(jsonRequest(`/api/projects/${project.id}`, "DELETE", undefined, OWNER), ctx({ id: project.id }));
    expect(await storage.exists(key)).toBe(false);
    const list = await (await listProjects(jsonRequest("/api/projects", "GET", undefined, OWNER), ctx({}))).json();
    expect(list.projects).toHaveLength(0);
  });

  it("refuses to retry a stage while another is running and validates the stage name", async () => {
    const { project } = await (await createProject(jsonRequest("/api/projects", "POST", { title: "T" }, OWNER), ctx({}))).json();
    const noSource = await retry(jsonRequest(`/api/projects/${project.id}/pipeline/retry`, "POST", { stage: "ingest" }, OWNER), ctx({ id: project.id }));
    expect(noSource.status).toBe(400);
    const sql = db();
    await sql`update projects set source_file_url = 'x', source_kind = 'txt' where id = ${project.id}`;
    await sql`insert into pipeline_runs (project_id, stage, status) values (${project.id}, 'ingest', 'running')`;
    const busy = await retry(jsonRequest(`/api/projects/${project.id}/pipeline/retry`, "POST", { stage: "extract_characters" }, OWNER), ctx({ id: project.id }));
    expect(busy.status).toBe(400);
    await sql`update pipeline_runs set status = 'failed' where project_id = ${project.id}`;
    const bad = await retry(jsonRequest(`/api/projects/${project.id}/pipeline/retry`, "POST", { stage: "render_book" }, OWNER), ctx({ id: project.id }));
    expect(bad.status).toBe(400);
    const ok = await retry(jsonRequest(`/api/projects/${project.id}/pipeline/retry`, "POST", { stage: "extract_characters" }, OWNER), ctx({ id: project.id }));
    expect(ok.status).toBe(202);
  });
});
