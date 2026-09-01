import { badRequest, forbidden, handle, json, notFound, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { updateCueSchema } from "@/lib/validation/schemas";
import type { CueRow } from "@/lib/db/types";
import { track } from "@/lib/analytics";

type Ctx = { params: Promise<{ id: string }> };

/** Manual speaker reassignment / delivery note / text edit for a cue (§7 PATCH /api/cues/:id). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  const sql = db();
  const [cue] = await sql<(CueRow & { project_id: string; owner_id: string })[]>`
    select cu.*, ch.project_id, p.owner_id from cues cu join chapters ch on ch.id = cu.chapter_id join projects p on p.id = ch.project_id where cu.id = ${id}`;
  if (!cue) throw notFound("Line");
  if (cue.owner_id !== user.id) throw forbidden();
  const body = await readJson(req, (d) => updateCueSchema.parse(d));

  const patch: Record<string, unknown> = { ...body };
  if (body.character_id) {
    const [c] = await sql`select id, is_narrator from characters where id = ${body.character_id} and project_id = ${cue.project_id} and merged_into_id is null`;
    if (!c) throw badRequest("That character does not belong to this project");
    patch.needs_review = body.needs_review ?? false;
    patch.confidence = 1;
    if (cue.type === "narration" && !c.is_narrator) patch.type = "dialogue";
  }
  const [updated] = await sql<CueRow[]>`update cues set ${sql(patch)} where id = ${id} returning *`;
  if (body.character_id || body.text !== undefined || body.delivery_note !== undefined) {
    await sql`update chapters set status = 'segmented' where id = ${cue.chapter_id} and status = 'rendered'`;
    await sql`delete from tts_cache where cue_id = ${id}`;
  }
  await sql`update projects set updated_at = now() where id = ${cue.project_id}`;
  if (body.character_id) await track("cue_reassigned", { projectId: cue.project_id, userId: user.id });
  return json({ cue: updated });
});
