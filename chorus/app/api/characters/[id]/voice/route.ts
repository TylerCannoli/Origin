import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getOwnedCharacter } from "@/lib/db/characters";
import { setVoiceSchema } from "@/lib/validation/schemas";
import { createTTS } from "@/lib/tts";
import type { CharacterRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ id: string }> };

/** Sets the AI voice override for a character, validating against the provider catalog. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const character = await getOwnedCharacter(id, user.id);
  const { ai_voice_id } = await readJson(req, (d) => setVoiceSchema.parse(d));
  const voices = await createTTS().listVoices();
  const voice = voices.find((v) => v.id === ai_voice_id);
  if (!voice) throw badRequest("That voice is not in the voice library");
  const sql = db();
  const [updated] = await sql<CharacterRow[]>`
    update characters set ai_voice_id = ${voice.id}, voice_rationale = ${`Chosen by you: ${voice.name}.`} where id = ${id} returning *`;
  await sql`update chapters set status = 'segmented' where status = 'rendered' and id in (select chapter_id from cues where character_id = ${id})`;
  await sql`update projects set updated_at = now() where id = ${character.project_id}`;
  return json({ character: updated });
});
