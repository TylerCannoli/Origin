import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { migrateTestDb, resetTestDb, closeDb, db } from "../helpers/db";
import { ctx, formRequest, jsonRequest } from "../helpers/request";
import { LocalStorageProvider, __setStorageForTests } from "@/lib/storage";
import { FakeLLM } from "@/lib/llm/fake";
import { LoggedLLM } from "@/lib/llm/logged";
import { MockTTS } from "@/lib/tts/mock";
import { FFmpeg } from "@/lib/audio/ffmpeg";
import { __setTTSForTests } from "@/lib/tts";
import { runStage } from "@/worker/queues/runner";
import "@/worker/queues/register";
import type { WorkerContext } from "@/worker/context";
import { POST as inviteCharacter } from "@/app/api/characters/[id]/invite/route";
import { POST as inviteProject } from "@/app/api/projects/[id]/invite/route";
import { GET as getRecordSession } from "@/app/api/record/[token]/route";
import { POST as uploadTake } from "@/app/api/record/[token]/cues/[cueId]/route";
import { POST as claim } from "@/app/api/record/[token]/claim/route";
import { PATCH as patchRecording, DELETE as deleteRecording } from "@/app/api/recordings/[id]/route";
import { GET as recordingAudio } from "@/app/api/recordings/[id]/audio/route";

const lantern = fs.readFileSync(path.join(__dirname, "../fixtures/lantern.txt"), "utf8");
const OWNER = "owner@example.com";
let ctxW: WorkerContext;

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

const fakeAudio = () => new File([Buffer.from("RIFFfakewavdata")], "take.webm", { type: "audio/webm" });

beforeAll(async () => {
  await migrateTestDb();
  const sql = db();
  const storage = new LocalStorageProvider(path.join(os.tmpdir(), "chorus-recording-test"));
  __setStorageForTests(storage);
  const tts = new MockTTS(new FFmpeg());
  __setTTSForTests(tts);
  ctxW = { sql, storage, llm: new LoggedLLM(new FakeLLM(), sql, { baseDelayMs: 1 }), enqueuer: { enqueue: async () => "job" }, tts, ffmpeg: new FFmpeg() };
});
beforeEach(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await closeDb();
});

describe("guest recording flow", () => {
  it("issues a character invite, serves the cues, accepts takes, and lets a guest claim them", async () => {
    const projectId = await seedProcessedProject();
    const sql = db();
    const [fen] = await sql`select id from characters where project_id = ${projectId} and canonical_name = 'Fen'`;

    const inviteRes = await inviteCharacter(jsonRequest(`/api/characters/${fen.id}/invite`, "POST", {}, OWNER), ctx({ id: fen.id }));
    expect(inviteRes.status).toBe(201);
    const { link } = await inviteRes.json();
    const token = link.split("/record/")[1];
    expect(token.length).toBeGreaterThan(20);

    const session = await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }));
    expect(session.status).toBe(200);
    const data = await session.json();
    expect(data.character.canonical_name).toBe("Fen");
    expect(data.viewer).toBeNull();
    const cues = data.chapters.flatMap((c: { cues: { id: string; character_id: string }[] }) => c.cues);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues.every((c: { character_id: string }) => c.character_id === fen.id)).toBe(true);
    expect(data.progress).toEqual({ recorded: 0, total: cues.length });

    // Upload a take for the first cue.
    const form = new FormData();
    form.append("file", fakeAudio());
    form.append("duration_ms", "1800");
    const up = await uploadTake(formRequest(`/api/record/${token}/cues/${cues[0].id}`, form), ctx({ token, cueId: cues[0].id }));
    expect(up.status).toBe(201);
    const { recording } = await up.json();
    expect(recording).toMatchObject({ cue_id: cues[0].id, guest_session_token: token, status: "submitted", duration_ms: 1800, recorded_by_user_id: null });
    expect(await ctxW.storage.exists(recording.audio_url)).toBe(true);

    // A cue belonging to another character is refused.
    const [otherCue] = await sql`select cu.id from cues cu join chapters ch on ch.id = cu.chapter_id where ch.project_id = ${projectId} and cu.character_id <> ${fen.id} limit 1`;
    const wrong = new FormData();
    wrong.append("file", fakeAudio());
    const refused = await uploadTake(formRequest(`/api/record/${token}/cues/${otherCue.id}`, wrong), ctx({ token, cueId: otherCue.id }));
    expect(refused.status).toBe(400);

    // Progress reflects the take and the guest sees their own recording.
    const after = await (await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }))).json();
    expect(after.progress.recorded).toBe(1);
    expect(after.chapters[0].cues[0].recordings).toHaveLength(1);

    // Guest audio access works with the token, not without.
    const noAuth = await recordingAudio(jsonRequest(`/api/recordings/${recording.id}/audio`, "GET"), ctx({ id: recording.id }));
    expect(noAuth.status).toBe(403);
    const withToken = await recordingAudio(jsonRequest(`/api/recordings/${recording.id}/audio?token=${token}`, "GET"), ctx({ id: recording.id }));
    expect(withToken.status).toBe(302);

    // Claim after signup.
    const claimed = await claim(jsonRequest(`/api/record/${token}/claim`, "POST", undefined, "reader@example.com"), ctx({ token }));
    expect((await claimed.json()).claimed).toBe(1);
    const [row] = await sql`select r.recorded_by_user_id, u.email, c.claimed_by_user_id from recordings r join users u on u.id = r.recorded_by_user_id join characters c on c.id = ${fen.id} where r.id = ${recording.id}`;
    expect(row.email).toBe("reader@example.com");
    expect(row.claimed_by_user_id).toBe(row.recorded_by_user_id);

    // Owner approves, a stranger cannot, guest can delete their own take.
    const stranger = await patchRecording(jsonRequest(`/api/recordings/${recording.id}`, "PATCH", { status: "approved" }, "stranger@example.com"), ctx({ id: recording.id }));
    expect(stranger.status).toBe(403);
    const approved = await patchRecording(jsonRequest(`/api/recordings/${recording.id}`, "PATCH", { status: "approved" }, OWNER), ctx({ id: recording.id }));
    expect((await approved.json()).recording.status).toBe("approved");
    const del = await deleteRecording(jsonRequest(`/api/recordings/${recording.id}?token=${token}`, "DELETE"), ctx({ id: recording.id }));
    expect(del.status).toBe(200);
    expect(await ctxW.storage.exists(recording.audio_url)).toBe(false);
  });

  it("project-wide links list parts and reject expired or revoked tokens", async () => {
    const projectId = await seedProcessedProject();
    const sql = db();
    const res = await inviteProject(jsonRequest(`/api/projects/${projectId}/invite`, "POST", { expires_in_days: 7 }, OWNER), ctx({ id: projectId }));
    const { link } = await res.json();
    const token = link.split("/record/")[1];
    const listing = await (await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }))).json();
    expect(listing.invite.scope).toBe("project");
    expect(listing.characters.length).toBeGreaterThan(2);
    const pick = listing.characters.find((c: { is_narrator: boolean }) => !c.is_narrator);
    const chosen = await (await getRecordSession(jsonRequest(`/api/record/${token}?character_id=${pick.id}`, "GET"), ctx({ token }))).json();
    expect(chosen.character.id).toBe(pick.id);

    await sql`update casting_invites set expires_at = now() - interval '1 day' where token = ${token}`;
    const expired = await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }));
    expect(expired.status).toBe(410);
    await sql`update casting_invites set expires_at = now() + interval '1 day', revoked_at = now() where token = ${token}`;
    const revoked = await getRecordSession(jsonRequest(`/api/record/${token}`, "GET"), ctx({ token }));
    expect(revoked.status).toBe(410);
    const missing = await getRecordSession(jsonRequest(`/api/record/nope`, "GET"), ctx({ token: "nope" }));
    expect(missing.status).toBe(404);
  });
});
