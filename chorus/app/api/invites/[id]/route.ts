import { forbidden, handle, json, notFound } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";

type Ctx = { params: Promise<{ id: string }> };

/** Turns off a casting link. Recordings made through it are kept. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const sql = db();
  const [invite] = await sql<{ id: string; owner_id: string }[]>`select i.id, p.owner_id from casting_invites i join projects p on p.id = i.project_id where i.id = ${id}`;
  if (!invite) throw notFound("Casting link");
  if (invite.owner_id !== user.id) throw forbidden();
  await sql`update casting_invites set revoked_at = now() where id = ${id}`;
  return json({ ok: true });
});
