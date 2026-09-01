import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedCharacter } from "@/lib/db/characters";
import { updateCharacterSchema } from "@/lib/validation/schemas";
import type { CharacterRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Rename / edit blurb / exclude / set voice / claim a character (§7 PATCH /api/characters/:id). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const character = await getOwnedCharacter(id, user.id);
  const body = await readJson(req, (d) => updateCharacterSchema.parse(d));
  if (character.is_narrator && (body.is_excluded || body.canonical_name)) throw badRequest("The narrator cannot be renamed or excluded");

  const { claim_self, ...rest } = body;
  const patch: Record<string, unknown> = { ...rest };
  if (claim_self !== undefined) patch.claimed_by_user_id = claim_self ? user.id : null;
  if (patch.aliases) patch.aliases = [...new Set((patch.aliases as string[]).map((a) => a.trim()).filter(Boolean))];

  const sql = db();
  const [updated] = await sql<CharacterRow[]>`update characters set ${sql(patch)} where id = ${id} returning *`;
  await sql`update projects set updated_at = now() where id = ${character.project_id}`;
  // Voice or exclusion changes affect rendered audio: mark affected chapters for re-render.
  if ("ai_voice_id" in patch || "is_excluded" in patch) {
    await sql`update chapters set status = 'segmented' where status = 'rendered' and id in (select chapter_id from cues where character_id = ${id})`;
  }
  return json({ character: updated });
});
