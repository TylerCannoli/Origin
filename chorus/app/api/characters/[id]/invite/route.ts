import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedCharacter } from "@/lib/db/characters";
import { createInvite } from "@/lib/db/invites";
import { inviteSchema } from "@/lib/validation/schemas";
import { rateLimit } from "@/lib/api/rate-limit";
import { track } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

/** Generates a casting link scoped to one character (§7 POST /api/characters/:id/invite). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await rateLimit(`invite:${user.id}`, 100, 3600);
  const character = await getOwnedCharacter(id, user.id);
  if (character.merged_into_id) throw badRequest("This character was merged into another");
  if (character.is_excluded) throw badRequest("Excluded characters are read by the narrator; restore the character to invite a reader");
  const body = await readJson(req, (d) => inviteSchema.parse(d ?? {}));
  const invite = await createInvite(character.project_id, character.id, body.expires_in_days);
  await track("invite_created", { projectId: character.project_id, userId: user.id, props: { scope: "character" } });
  return json({ invite, link: invite.link }, { status: 201 });
});
