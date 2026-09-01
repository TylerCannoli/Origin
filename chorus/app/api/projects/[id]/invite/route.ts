import { handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedProject } from "@/lib/db/projects";
import { createInvite } from "@/lib/db/invites";
import { inviteSchema } from "@/lib/validation/schemas";
import { db } from "@/lib/db/client";
import type { CastingInviteRow } from "@/lib/db/types";
import { rateLimit } from "@/lib/api/rate-limit";
import { track } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

/** Project-wide casting link: the reader picks any unclaimed character. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await rateLimit(`invite:${user.id}`, 100, 3600);
  await getOwnedProject(id, user.id);
  const body = await readJson(req, (d) => inviteSchema.parse(d ?? {}));
  const invite = await createInvite(id, null, body.expires_in_days);
  await track("invite_created", { projectId: id, userId: user.id, props: { scope: "project" } });
  return json({ invite, link: invite.link }, { status: 201 });
});

/** Lists active casting links for the project. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  const invites = await db()<(CastingInviteRow & { character_name: string | null })[]>`
    select i.*, c.canonical_name as character_name from casting_invites i left join characters c on c.id = i.character_id
    where i.project_id = ${id} and i.revoked_at is null order by i.created_at desc`;
  return json({ invites });
});
