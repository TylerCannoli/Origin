import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedCharacter } from "@/lib/db/characters";
import { mergeCharacterSchema } from "@/lib/validation/schemas";
import type { CharacterRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Merges this character into another: cues and recordings move, the source keeps a pointer for undo. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const source = await getOwnedCharacter(id, user.id);
  const { into_character_id } = await readJson(req, (d) => mergeCharacterSchema.parse(d));
  if (into_character_id === id) throw badRequest("Choose a different character to merge into");
  const target = await getOwnedCharacter(into_character_id, user.id);
  if (target.project_id !== source.project_id) throw badRequest("Both characters must belong to the same project");
  if (source.is_narrator) throw badRequest("The narrator cannot be merged into another character");
  if (target.merged_into_id) throw badRequest("That character has already been merged");

  const sql = db();
  const [merged] = await sql.begin(async (tx) => {
    await tx`update cues set character_id = ${target.id} where character_id = ${source.id}`;
    await tx`update characters set merged_into_id = ${target.id}, claimed_by_user_id = null where id = ${source.id}`;
    const aliases = [...new Set([...(target.aliases ?? []), source.canonical_name, ...(source.aliases ?? [])].filter((a) => a.toLowerCase() !== target.canonical_name.toLowerCase()))];
    const rows = await tx<CharacterRow[]>`update characters set aliases = ${aliases} where id = ${target.id} returning *`;
    await tx`update chapters set status = 'segmented' where status = 'rendered' and id in (select chapter_id from cues where character_id = ${target.id})`;
    await tx`update projects set updated_at = now() where id = ${target.project_id}`;
    return rows;
  });
  return json({ character: merged });
});
