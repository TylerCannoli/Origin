import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { ctx, formRequest, jsonRequest } from "../helpers/request";
import { GET as listProjects, POST as createProject } from "@/app/api/projects/route";
import { GET as getProject, PATCH as patchProject, DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { POST as upload } from "@/app/api/projects/[id]/upload/route";
import { __setStorageForTests, LocalStorageProvider } from "@/lib/storage";
import { __setEnqueuerForTests } from "@/lib/queue";
import path from "node:path";
import os from "node:os";

const enqueued: { stage: string; payload: unknown }[] = [];

beforeAll(async () => {
  await migrateTestDb();
  __setStorageForTests(new LocalStorageProvider(path.join(os.tmpdir(), "chorus-test-storage")));
  __setEnqueuerForTests({
    async enqueue(stage, payload) {
      enqueued.push({ stage, payload });
      return "job";
    },
  });
});
beforeEach(async () => {
  await resetTestDb();
  enqueued.length = 0;
});
afterAll(async () => {
  await closeDb();
});

describe("projects API", () => {
  it("rejects anonymous requests", async () => {
    const res = await listProjects(jsonRequest("/api/projects", "GET"), ctx({}));
    expect(res.status).toBe(401);
  });

  it("creates, lists, updates and deletes a project for its owner only", async () => {
    const created = await createProject(jsonRequest("/api/projects", "POST", { title: "Little Women" }, "amy@example.com"), ctx({}));
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(project.visibility).toBe("private");
    expect(project.rights_attested).toBe(false);

    const list = await (await listProjects(jsonRequest("/api/projects", "GET", undefined, "amy@example.com"), ctx({}))).json();
    expect(list.projects).toHaveLength(1);

    const other = await getProject(jsonRequest(`/api/projects/${project.id}`, "GET", undefined, "jo@example.com"), ctx({ id: project.id }));
    expect(other.status).toBe(403);

    const patched = await patchProject(jsonRequest(`/api/projects/${project.id}`, "PATCH", { pacing: "relaxed", visibility: "public_listen" }, "amy@example.com"), ctx({ id: project.id }));
    expect((await patched.json()).project.pacing).toBe("relaxed");

    const bad = await patchProject(jsonRequest(`/api/projects/${project.id}`, "PATCH", { pacing: "hyper" }, "amy@example.com"), ctx({ id: project.id }));
    expect(bad.status).toBe(400);

    const del = await deleteProject(jsonRequest(`/api/projects/${project.id}`, "DELETE", undefined, "amy@example.com"), ctx({ id: project.id }));
    expect(del.status).toBe(200);
    const gone = await getProject(jsonRequest(`/api/projects/${project.id}`, "GET", undefined, "amy@example.com"), ctx({ id: project.id }));
    expect(gone.status).toBe(404);
  });

  it("requires the rights attestation and enqueues ingest on upload", async () => {
    const { project } = await (await createProject(jsonRequest("/api/projects", "POST", { title: "Test" }, "amy@example.com"), ctx({}))).json();

    const noAttest = await upload(jsonRequest(`/api/projects/${project.id}/upload`, "POST", { text: "Hello world" }, "amy@example.com"), ctx({ id: project.id }));
    expect(noAttest.status).toBe(400);
    expect(enqueued).toHaveLength(0);

    const form = new FormData();
    form.append("file", new File(["Chapter 1\n\n\"Hello,\" said Beth."], "book.txt", { type: "text/plain" }));
    form.append("rights_attested", "true");
    const ok = await upload(formRequest(`/api/projects/${project.id}/upload`, form, "amy@example.com"), ctx({ id: project.id }));
    expect(ok.status).toBe(202);
    expect(enqueued).toEqual([{ stage: "ingest", payload: { project_id: project.id, force: true } }]);

    const [row] = await db()`select status, rights_attested, source_kind from projects where id = ${project.id}`;
    expect(row).toMatchObject({ status: "processing", rights_attested: true, source_kind: "txt" });
    const runs = await db()`select stage, status from pipeline_runs where project_id = ${project.id}`;
    expect(runs).toEqual([{ stage: "ingest", status: "queued" }]);

    const badExt = new FormData();
    badExt.append("file", new File(["x"], "book.exe"));
    badExt.append("rights_attested", "true");
    // processing guard fires first; reset status to test extension check
    await db()`update projects set status = 'ready' where id = ${project.id}`;
    const rej = await upload(formRequest(`/api/projects/${project.id}/upload`, badExt, "amy@example.com"), ctx({ id: project.id }));
    expect(rej.status).toBe(400);
  });
});
