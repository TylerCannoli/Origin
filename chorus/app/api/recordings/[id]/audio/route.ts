import { NextResponse } from "next/server";
import { forbidden, handle, notFound } from "@/lib/api/errors";
import { getSessionUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { storage } from "@/lib/storage";
import type { RecordingRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Redirects to a short-lived signed URL for a take. Owner, recorder, or matching guest token. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await getSessionUser(req);
  const [r] = await db()<(RecordingRow & { owner_id: string })[]>`
    select r.*, p.owner_id from recordings r join cues cu on cu.id = r.cue_id join chapters ch on ch.id = cu.chapter_id join projects p on p.id = ch.project_id where r.id = ${id}`;
  if (!r) throw notFound("Recording");
  const token = new URL(req.url).searchParams.get("token");
  const allowed = (user && (user.id === r.owner_id || user.id === r.recorded_by_user_id)) || (token && token === r.guest_session_token);
  if (!allowed) throw forbidden();
  return NextResponse.redirect(await storage().signedUrl(r.audio_url, 600), { status: 302 });
});
