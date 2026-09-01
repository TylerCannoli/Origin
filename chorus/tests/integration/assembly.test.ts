import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { ctx, jsonRequest } from "../helpers/request";
import { LocalStorageProvider, __setStorageForTests } from "@/lib/storage";
import { FakeLLM } from "@/lib/llm/fake";
import { LoggedLLM } from "@/lib/llm/logged";
import { MockTTS } from "@/lib/tts/mock";
import { FFmpeg } from "@/lib/audio/ffmpeg";
import { __setTTSForTests } from "@/lib/tts";
import { __setEnqueuerForTests, type Enqueuer } from "@/lib/queue";
import { runStage } from "@/worker/queues/runner";
import "@/worker/queues/register";
import type { WorkerContext } from "@/worker/context";
import { gapBetween } from "@/worker/agents/assembly";
import { POST as render } from "@/app/api/projects/[id]/render/route";
import { GET as audioList } from "@/app/api/projects/[id]/audio/route";
import { GET as listen } from "@/app/api/projects/[id]/listen/route";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");
const OWNER = "owner@example.com";
let ctxW: WorkerContext;
const enqueued: { stage: string; payload: Record<string, unknown> }[] = [];
const fakeEnqueuer: Enqueuer = {
  async enqueue(stage, payload) {
    enqueued.push({ stage, payload: payload as Record<string, unknown> });
    return "job";
  },
};

async function seedProcessedProject() {
  const sql = db();
  const [user] = await sql`insert into users (id, email) values (gen_random_uuid(), ${OWNER}) returning id`;
  const [project] = await sql`insert into projects (owner_id, title, rights_attested, status) values (${user.id}, 'The Lantern Keeper', true, 'processing') returning id`;
  const key = `projects/${project.id}/source/manuscript.txt`;
  await ctxW.storage.put(key, Buffer.from(lantern), "text/plain");
  await sql`update projects set source_file_url = ${key}, source_kind = 'txt' where id = ${project.id}`;
  for (const stage of ["ingest", "extract_characters", "attribute_dialogue", "segment_script", "cast_voices"] as const) {
    await runStage(ctxW, stage, { project_id: project.id }, { finalAttempt: true });
  }
  return project.id as string;
}

/** Real audio for a human take: a short tone rendered by ffmpeg into WAV. */
async function fakeHumanTake(): Promise<Buffer> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "chorus-take-"));
  const file = path.join(dir, "take.wav");
  await ctxW.ffmpeg.run(["-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-ac", "1", "-ar", "48000", file]);
  const buf = await fsp.readFile(file);
  await fsp.rm(dir, { recursive: true, force: true });
  return buf;
}

beforeAll(async () => {
  await migrateTestDb();
  const sql = db();
  const storage = new LocalStorageProvider(path.join(os.tmpdir(), "chorus-assembly-test"));
  __setStorageForTests(storage);
  __setEnqueuerForTests(fakeEnqueuer);
  const tts = new MockTTS(new FFmpeg());
  __setTTSForTests(tts);
  ctxW = { sql, storage, llm: new LoggedLLM(new FakeLLM(), sql, { baseDelayMs: 1 }), enqueuer: fakeEnqueuer, tts, ffmpeg: new FFmpeg() };
});
beforeEach(async () => {
  await resetTestDb();
  enqueued.length = 0;
});
afterAll(async () => {
  await closeDb();
});

describe("gap presets", () => {
  it("shortens gaps within an exchange and lengthens narration shifts", () => {
    expect(gapBetween("dialogue", "dialogue", "normal")).toBeLessThan(gapBetween("narration", "dialogue", "normal"));
    expect(gapBetween("dialogue", "dialogue", "tight")).toBeLessThan(gapBetween("dialogue", "dialogue", "relaxed"));
    expect(gapBetween(null, "narration", "normal")).toBe(0);
  });
});

describe("assembly and mastering", () => {
  it("renders chapters with human + AI clips, caches TTS, builds the book, and re-renders only changed chapters", async () => {
    const projectId = await seedProcessedProject();
    const sql = db();
    const chapters = await sql<{ id: string; title: string }[]>`select id, title from chapters where project_id = ${projectId} order by order_index`;
    expect(chapters).toHaveLength(3);

    // Add a human take to a cue in chapter 1.
    const [cue] = await sql`select id from cues where chapter_id = ${chapters[0].id} and type = 'dialogue' order by order_index limit 1`;
    const takeKey = `projects/${projectId}/recordings/${cue.id}/take.wav`;
    await ctxW.storage.put(takeKey, await fakeHumanTake(), "audio/wav");
    await sql`insert into recordings (cue_id, guest_session_token, audio_url, mime_type, status) values (${cue.id}, 'tok', ${takeKey}, 'audio/wav', 'submitted')`;

    // Kick off via the API: all chapters stale -> 3 chapter jobs.
    const res = await render(jsonRequest(`/api/projects/${projectId}/render`, "POST", {}, OWNER), ctx({ id: projectId }));
    expect(res.status).toBe(202);
    expect(enqueued.filter((e) => e.stage === "render_chapter")).toHaveLength(3);
    const busy = await render(jsonRequest(`/api/projects/${projectId}/render`, "POST", {}, OWNER), ctx({ id: projectId }));
    expect(busy.status).toBe(400);

    const batch = enqueued[0].payload.batch_id as string;
    for (const ch of chapters) {
      await runStage(ctxW, "render_chapter", { project_id: projectId, chapter_id: ch.id, force: true, then_render_book: true, batch_id: batch }, { finalAttempt: true });
    }
    // The last chapter enqueued the book render.
    const bookJobs = enqueued.filter((e) => e.stage === "render_book");
    expect(bookJobs).toHaveLength(1);
    await runStage(ctxW, "render_book", { project_id: projectId, force: true, batch_id: batch }, { finalAttempt: true });

    const renders = await sql<{ scope: string; format: string; audio_url: string; duration_ms: number; chapter_id: string | null; chapter_markers: { title: string; start_ms: number }[] | null }[]>`
      select scope, format, audio_url, duration_ms, chapter_id, chapter_markers from rendered_audio where project_id = ${projectId} order by scope, format`;
    expect(renders.filter((r) => r.scope === "chapter")).toHaveLength(3);
    const book = renders.filter((r) => r.scope === "full_book");
    expect(book.map((b) => b.format).sort()).toEqual(["m4b", "mp3"]);
    for (const r of renders) {
      expect(await ctxW.storage.exists(r.audio_url)).toBe(true);
      expect(r.duration_ms).toBeGreaterThan(1000);
    }
    const markers = book.find((b) => b.format === "mp3")!.chapter_markers!;
    expect(markers.map((m) => m.title)).toEqual(chapters.map((c) => c.title));
    expect(markers[0].start_ms).toBe(0);
    expect(markers[2].start_ms).toBeGreaterThan(markers[1].start_ms);
    const chapterSum = renders.filter((r) => r.scope === "chapter").reduce((n, r) => n + r.duration_ms, 0);
    expect(Math.abs(book[0].duration_ms - chapterSum)).toBeLessThan(1500);

    const statuses = await sql`select status from chapters where project_id = ${projectId}`;
    expect(statuses.every((s) => s.status === "rendered")).toBe(true);
    const [{ cached }] = await sql<{ cached: number }[]>`select count(*)::int as cached from tts_cache where project_id = ${projectId}`;
    const [{ cues: cueCount }] = await sql<{ cues: number }[]>`select count(*)::int as cues from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${projectId}`;
    expect(cached).toBe(cueCount - 1); // every cue except the human-recorded one

    // Audio listing + public listen visibility.
    const listing = await (await audioList(jsonRequest(`/api/projects/${projectId}/audio`, "GET", undefined, OWNER), ctx({ id: projectId }))).json();
    expect(listing.chapters.every((c: { stale: boolean; render: unknown }) => !c.stale && c.render)).toBe(true);
    expect(listing.book.mp3.url).toContain("/api/storage/");
    const privateListen = await listen(jsonRequest(`/api/projects/${projectId}/listen`, "GET"), ctx({ id: projectId }));
    expect(privateListen.status).toBe(403);
    await sql`update projects set visibility = 'public_listen' where id = ${projectId}`;
    const publicListen = await (await listen(jsonRequest(`/api/projects/${projectId}/listen`, "GET"), ctx({ id: projectId }))).json();
    expect(publicListen.chapters).toHaveLength(3);
    expect(publicListen.book.m4b.url).toBeTruthy();

    // Idempotent: nothing stale -> only a book render is queued, chapter renders untouched.
    enqueued.length = 0;
    const again = await render(jsonRequest(`/api/projects/${projectId}/render`, "POST", {}, OWNER), ctx({ id: projectId }));
    expect(again.status).toBe(202);
    expect(enqueued.map((e) => e.stage)).toEqual(["render_book"]);
    await sql`update pipeline_runs set status = 'complete' where project_id = ${projectId} and status = 'queued'`;
    const before = await sql<{ chapter_id: string; audio_url: string }[]>`select chapter_id, audio_url from rendered_audio where project_id = ${projectId} and scope = 'chapter'`;
    const noop = await runStage(ctxW, "render_chapter", { project_id: projectId, chapter_id: chapters[1].id }, { finalAttempt: true });
    void noop;
    const afterNoop = await sql<{ chapter_id: string; audio_url: string }[]>`select chapter_id, audio_url from rendered_audio where project_id = ${projectId} and scope = 'chapter'`;
    expect(afterNoop).toEqual(before);

    // A new take on chapter 2 marks only that chapter stale; the render route re-renders just it.
    const [cue2] = await sql`select id from cues where chapter_id = ${chapters[1].id} order by order_index limit 1`;
    await ctxW.storage.put(`projects/${projectId}/recordings/${cue2.id}/take2.wav`, await fakeHumanTake(), "audio/wav");
    await sql`insert into recordings (cue_id, guest_session_token, audio_url, mime_type, status) values (${cue2.id}, 'tok', ${`projects/${projectId}/recordings/${cue2.id}/take2.wav`}, 'audio/wav', 'submitted')`;
    await sql`update chapters set status = 'segmented' where id = ${chapters[1].id}`; // what the upload route does
    enqueued.length = 0;
    const partial = await (await render(jsonRequest(`/api/projects/${projectId}/render`, "POST", {}, OWNER), ctx({ id: projectId }))).json();
    expect(partial.chapters_queued).toBe(1);
    expect(enqueued.map((e) => e.stage)).toEqual(["render_chapter"]);
    expect(enqueued[0].payload.chapter_id).toBe(chapters[1].id);
    await runStage(ctxW, "render_chapter", enqueued[0].payload as never, { finalAttempt: true });
    const afterPartial = await sql<{ chapter_id: string; audio_url: string }[]>`select chapter_id, audio_url from rendered_audio where project_id = ${projectId} and scope = 'chapter'`;
    const unchanged = afterPartial.filter((r) => r.chapter_id !== chapters[1].id);
    expect(unchanged).toEqual(before.filter((r) => r.chapter_id !== chapters[1].id));
    expect(afterPartial.find((r) => r.chapter_id === chapters[1].id)!.audio_url).not.toBe(before.find((r) => r.chapter_id === chapters[1].id)!.audio_url);
    // The stale full-book render was dropped and the book job re-queued.
    expect(enqueued.map((e) => e.stage)).toEqual(["render_chapter", "render_book"]);
    const [{ books }] = await sql<{ books: number }[]>`select count(*)::int as books from rendered_audio where project_id = ${projectId} and scope = 'full_book'`;
    expect(books).toBe(0);
    const [{ cachedAfter }] = await sql<{ cachedAfter: number }[]>`select count(*)::int as "cachedAfter" from tts_cache where project_id = ${projectId}`;
    expect(cachedAfter).toBe(cached); // cache reused, no new synthesis rows
  }, 240_000);

  it("fails clearly when the book is requested before chapters exist", async () => {
    const projectId = await seedProcessedProject();
    await expect(runStage(ctxW, "render_book", { project_id: projectId }, { finalAttempt: true })).rejects.toThrow(/not rendered yet/);
  });
});
