import { db } from "@/lib/db/client";
import type { CharacterRow } from "@/lib/db/types";
import { forbidden, notFound } from "@/lib/api/errors";

export interface CharacterWithStats extends CharacterRow {
  line_count: number;
  recorded_count: number;
  claimed_by_email: string | null;
}

export async function listCharacters(projectId: string): Promise<CharacterWithStats[]> {
  return db()<CharacterWithStats[]>`
    select c.*,
      (select count(*)::int from cues cu where cu.character_id = c.id) as line_count,
      (select count(distinct r.cue_id)::int from recordings r join cues cu on cu.id = r.cue_id where cu.character_id = c.id and r.status <> 'rejected') as recorded_count,
      u.email as claimed_by_email
    from characters c left join users u on u.id = c.claimed_by_user_id
    where c.project_id = ${projectId} and c.merged_into_id is null
    order by c.is_narrator desc, line_count desc, c.canonical_name`;
}

/** Loads a character and asserts the caller owns its project. */
export async function getOwnedCharacter(characterId: string, userId: string): Promise<CharacterRow & { owner_id: string }> {
  const [row] = await db()<(CharacterRow & { owner_id: string })[]>`
    select c.*, p.owner_id from characters c join projects p on p.id = c.project_id where c.id = ${characterId}`;
  if (!row) throw notFound("Character");
  if (row.owner_id !== userId) throw forbidden();
  return row;
}
