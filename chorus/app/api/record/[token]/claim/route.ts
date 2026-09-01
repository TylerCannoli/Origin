import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { resolveInvite } from "@/lib/db/invites";
import { db } from "@/lib/db/client";
import { track } from "@/lib/analytics";

type Ctx = { params: Promise<{ token: string }> };

/** Attaches recordings made under a guest token to the signed-in user (§5.4 "claim later"). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { token } = await params;
  const user = await requireUser(req);
  const { invite, character } = await resolveInvite(token);
  const sql = db();
  const claimed = await sql`update recordings set recorded_by_user_id = ${user.id} where guest_session_token = ${invite.token} and recorded_by_user_id is null returning id`;
  if (character && !character.claimed_by_user_id) {
    await sql`update characters set claimed_by_user_id = ${user.id} where id = ${character.id} and claimed_by_user_id is null`;
  }
  await track("recordings_claimed", { projectId: invite.project_id, userId: user.id, props: { count: claimed.length } });
  return json({ claimed: claimed.length });
});
