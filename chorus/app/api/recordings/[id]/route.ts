import { forbidden, handle, json, notFound, readJson } from "@/lib/api/errors";
import { getSessionUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { storage } from "@/lib/storage";
import { invalidateChapterForCue } from "@/lib/db/recordings";
import { recordingStatusSchema } from "@/lib/validation/schemas";
import type { RecordingRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

async function loadRecording(id: string) {
  const [row] = await db()<(RecordingRow & { owner_id: string; project_id: string })[]>`
    select r.*, p.owner_id, p.id as project_id from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id join projects p on p.id = ch.project_id
    where r.id = ${id}`;
  if (!row) throw notFound("Recording");
  return row;
}

/** Owner approves/rejects a take. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await getSessionUser(req);
  const recording = await loadRecording(id);
  if (!user || user.id !== recording.owner_id) throw forbidden("Only the project owner can approve or reject takes");
  const { status } = await readJson(req, (d) => recordingStatusSchema.parse(d));
  const [updated] = await db()<RecordingRow[]>`update recordings set status = ${status} where id = ${id} returning *`;
  await invalidateChapterForCue(recording.cue_id);
  return json({ recording: updated });
});

/** Deletes a take: the owner, the user who recorded it, or the guest session that made it (via ?token=). */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await getSessionUser(req);
  const recording = await loadRecording(id);
  const token = new URL(req.url).searchParams.get("token");
  const allowed = (user && (user.id === recording.owner_id || user.id === recording.recorded_by_user_id)) || (token && token === recording.guest_session_token);
  if (!allowed) throw forbidden();
  await db()`delete from recordings where id = ${id}`;
  await storage().delete(recording.audio_url).catch(() => {});
  await invalidateChapterForCue(recording.cue_id);
  return json({ ok: true });
});
