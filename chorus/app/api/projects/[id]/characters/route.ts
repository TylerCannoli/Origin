import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { getOwnedProject } from "@/lib/db/projects";
import { listCharacters } from "@/lib/db/characters";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const user = await requireUser(req);
  await getOwnedProject(id, user.id);
  return json({ characters: await listCharacters(id) });
});
