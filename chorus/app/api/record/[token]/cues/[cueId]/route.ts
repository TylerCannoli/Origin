import { badRequest, handle, json, notFound } from "@/lib/api/errors";
import { resolveInvite } from "@/lib/db/invites";
import { getSessionUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { storage, storageKeys } from "@/lib/storage";
import { invalidateChapterForCue } from "@/lib/db/recordings";
import { rateLimit, clientIp } from "@/lib/api/rate-limit";
import type { CueRow, RecordingRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ token: string; cueId: string }> };

const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" };

/** (public/token) Uploads a take for a cue. multipart/form-data: file, duration_ms. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { token, cueId } = await params;
  await rateLimit(`record:upload:${token}`, 600, 3600);
  await rateLimit(`record:upload-ip:${clientIp(req)}`, 600, 3600);
  const { invite, project, character } = await resolveInvite(token);
  const user = await getSessionUser(req);
  const sql = db();
  const [cue] = await sql<(CueRow & { project_id: string; is_excluded: boolean })[]>`
    select cu.*, ch.project_id, c.is_excluded from cues cu join chapters ch on ch.id = cu.chapter_id join characters c on c.id = cu.character_id where cu.id = ${cueId}`;
  if (!cue || cue.project_id !== project.id) throw notFound("Line");
  if (character && cue.character_id !== character.id) throw badRequest("This line belongs to a different character");
  if (!character && cue.is_excluded) throw badRequest("This character is read by the narrator");

  const form = await req.formData().catch(() => {
    throw badRequest("Send the recording as multipart/form-data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No audio file was attached");
  if (file.size === 0) throw badRequest("The recording is empty");
  if (file.size > MAX_RECORDING_BYTES) throw badRequest("Recordings must be under 25 MB");
  const mime = (file.type || "audio/webm").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime];
  if (!ext) throw badRequest(`Unsupported audio format ${mime}`);
  const durationRaw = Number(form.get("duration_ms") ?? 0);
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;
  if (duration && duration > MAX_DURATION_MS) throw badRequest("Takes must be under 10 minutes");

  const [placeholder] = await sql<{ id: string }[]>`select gen_random_uuid() as id`;
  const key = storageKeys.recording(project.id, cue.id, placeholder.id, ext);
  await storage().put(key, Buffer.from(await file.arrayBuffer()), mime);
  const [recording] = await sql<RecordingRow[]>`insert into recordings ${sql({
    id: placeholder.id,
    cue_id: cue.id,
    recorded_by_user_id: user?.id ?? null,
    guest_session_token: invite.token,
    audio_url: key,
    duration_ms: duration,
    mime_type: mime,
    status: "submitted",
  })} returning *`;
  await invalidateChapterForCue(cue.id);
  await sql`update projects set updated_at = now() where id = ${project.id}`;
  return json({ recording }, { status: 201 });
});
