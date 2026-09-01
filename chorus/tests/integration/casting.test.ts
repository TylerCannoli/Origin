import fs from "node:fs";
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
import { runStage } from "@/worker/queues/runner";
import "@/worker/queues/register";
import type { WorkerContext } from "@/worker/context";
import type { Enqueuer } from "@/lib/queue";
import { GET as listCharacters } from "@/app/api/projects/[id]/characters/route";
import { GET as getScript } from "@/app/api/projects/[id]/script/route";
import { PATCH as patchCharacter } from "@/app/api/characters/[id]/route";
import { POST as mergeCharacter } from "@/app/api/characters/[id]/merge/route";
import { PATCH as setVoice } from "@/app/api/characters/[id]/voice/route";
import { PATCH as patchCue } from "@/app/api/cues/[id]/route";
import { POST as audition } from "@/app/api/voices/audition/route";
import { __setTTSForTests } from "@/lib/tts";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");
const OWNER = "owner@example.com";

let ctxW: WorkerContext;
const enqueued: { stage: string }[] = [];
const fakeEnqueuer: Enqueuer = {
  async enqueue(stage) {
    enqueued.push({ stage });
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

beforeAll(async () => {
  await migrateTestDb();
  const sql = db();
  const storage = new LocalStorageProvider(path.join(os.tmpdir(), "chorus-casting-test"));
  __setStorageForTests(storage);
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

describe("segmentation + casting stages", () => {
  it("creates cues per chapter with delivery notes, assigns voices, and marks the project ready", async () => {
    const projectId = await seedProcessedProject();
    const sql = db();
    const [p] = await sql`select status from projects where id = ${projectId}`;
    expect(p.status).toBe("ready");
    const chapters = await sql`select status from chapters where project_id = ${projectId}`;
    expect(chapters.every((c) => c.status === "segmented")).toBe(true);

    const res = await getScript(jsonRequest(`/api/projects/${projectId}/script`, "GET", undefined, OWNER), ctx({ id: projectId }));
    const { chapters: script } = await res.json();
    expect(script).toHaveLength(3);
    const cues = script.flatMap((c: { cues: unknown[] }) => c.cues) as { type: string; text: string; delivery_note: string | null; character_name: string; order_index: number }[];
    expect(cues[0].type).toBe("narration");
    expect(cues[0].character_name).toBe("Narrator");
    const called = cues.find((c) => c.text === "I heard him,");
    expect(called?.delivery_note).toBe("called across a distance");
    const gasped = cues.find((c) => c.text.startsWith("Miss Quill"));
    expect(gasped?.delivery_note).toBe("gasping, breathless");
    expect(cues.map((c) => c.order_index).slice(0, 5)).toEqual([0, 1, 2, 3, 4]);

    const chars = await (await listCharacters(jsonRequest(`/api/projects/${projectId}/characters`, "GET", undefined, OWNER), ctx({ id: projectId }))).json();
    expect(chars.characters.every((c: { ai_voice_id: string | null }) => c.ai_voice_id)).toBe(true);
    const narrator = chars.characters.find((c: { is_narrator: boolean }) => c.is_narrator);
    expect(narrator.line_count).toBeGreaterThan(10);
    const voiceIds = chars.characters.map((c: { ai_voice_id: string }) => c.ai_voice_id);
    expect(new Set(voiceIds).size).toBe(voiceIds.length);
  });

  it("supports rename, exclude, voice override, merge, and manual cue reassignment", async () => {
    const projectId = await seedProcessedProject();
    const sql = db();
    const chars = (await (await listCharacters(jsonRequest(`/api/projects/${projectId}/characters`, "GET", undefined, OWNER), ctx({ id: projectId }))).json()).characters as { id: string; canonical_name: string; is_narrator: boolean; line_count: number }[];
    const fen = chars.find((c) => c.canonical_name === "Fen")!;
    const ida = chars.find((c) => c.canonical_name.startsWith("Ida"))!;

    const renamed = await patchCharacter(jsonRequest(`/api/characters/${fen.id}`, "PATCH", { canonical_name: "Fen Ardell", aliases: ["Fen", "the boy"] }, OWNER), ctx({ id: fen.id }));
    expect((await renamed.json()).character).toMatchObject({ canonical_name: "Fen Ardell", aliases: ["Fen", "the boy"] });

    const other = await patchCharacter(jsonRequest(`/api/characters/${fen.id}`, "PATCH", { canonical_name: "x" }, "stranger@example.com"), ctx({ id: fen.id }));
    expect(other.status).toBe(403);

    const excluded = await patchCharacter(jsonRequest(`/api/characters/${ida.id}`, "PATCH", { is_excluded: true }, OWNER), ctx({ id: ida.id }));
    expect((await excluded.json()).character.is_excluded).toBe(true);

    const voice = await setVoice(jsonRequest(`/api/characters/${fen.id}/voice`, "PATCH", { ai_voice_id: "mock-pip" }, OWNER), ctx({ id: fen.id }));
    expect((await voice.json()).character.ai_voice_id).toBe("mock-pip");
    const badVoice = await setVoice(jsonRequest(`/api/characters/${fen.id}/voice`, "PATCH", { ai_voice_id: "nope" }, OWNER), ctx({ id: fen.id }));
    expect(badVoice.status).toBe(400);

    const narrator = chars.find((c) => c.is_narrator)!;
    const mergeNarrator = await mergeCharacter(jsonRequest(`/api/characters/${narrator.id}/merge`, "POST", { into_character_id: fen.id }, OWNER), ctx({ id: narrator.id }));
    expect(mergeNarrator.status).toBe(400);

    const merged = await mergeCharacter(jsonRequest(`/api/characters/${ida.id}/merge`, "POST", { into_character_id: fen.id }, OWNER), ctx({ id: ida.id }));
    expect(merged.status).toBe(200);
    const [fenRow] = await sql`select aliases, (select count(*)::int from cues where character_id = ${fen.id}) as lines from characters where id = ${fen.id}`;
    expect(fenRow.aliases).toContain(ida.canonical_name);
    expect(fenRow.lines).toBe(fen.line_count + ida.line_count);
    const after = (await (await listCharacters(jsonRequest(`/api/projects/${projectId}/characters`, "GET", undefined, OWNER), ctx({ id: projectId }))).json()).characters as { id: string }[];
    expect(after.some((c) => c.id === ida.id)).toBe(false);

    const [cue] = await sql`select cu.id from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${projectId} and cu.type = 'dialogue' limit 1`;
    const reassigned = await patchCue(jsonRequest(`/api/cues/${cue.id}`, "PATCH", { character_id: fen.id, delivery_note: "soft" }, OWNER), ctx({ id: cue.id }));
    expect((await reassigned.json()).cue).toMatchObject({ character_id: fen.id, needs_review: false, delivery_note: "soft" });
    const badCue = await patchCue(jsonRequest(`/api/cues/${cue.id}`, "PATCH", { character_id: "00000000-0000-0000-0000-000000000000" }, OWNER), ctx({ id: cue.id }));
    expect(badCue.status).toBe(400);
  });

  it("auditions a voice and caches the preview", async () => {
    const sql = db();
    await sql`insert into users (id, email) values (gen_random_uuid(), ${OWNER})`;
    const first = await audition(jsonRequest("/api/voices/audition", "POST", { voice_id: "mock-juno", text: "Hello there." }, OWNER), ctx({}));
    expect(first.status).toBe(200);
    const { url, voice } = await first.json();
    expect(voice.id).toBe("mock-juno");
    expect(url).toContain("/api/storage/auditions/mock-juno/");
    const again = await audition(jsonRequest("/api/voices/audition", "POST", { voice_id: "mock-juno", text: "Hello there." }, OWNER), ctx({}));
    expect((await again.json()).url.split("?")[0]).toBe(url.split("?")[0]);
    const unknown = await audition(jsonRequest("/api/voices/audition", "POST", { voice_id: "ghost" }, OWNER), ctx({}));
    expect(unknown.status).toBe(400);
  });
});
