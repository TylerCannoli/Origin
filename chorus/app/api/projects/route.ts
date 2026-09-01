import { handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { listProjectsForOwner } from "@/lib/db/projects";
import { createProjectSchema } from "@/lib/validation/schemas";
import type { ProjectRow } from "@/lib/db/types";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const projects = await listProjectsForOwner(user.id);
  return json({ projects });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req, (d) => createProjectSchema.parse(d));
  const [project] = await db()<ProjectRow[]>`
    insert into projects (owner_id, title, visibility) values (${user.id}, ${body.title}, ${body.visibility}) returning *`;
  return json({ project }, { status: 201 });
});
