import { handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { listProjectsForOwner } from "@/lib/db/projects";
import { createProjectSchema } from "@/lib/validation/schemas";
import type { ProjectRow } from "@/lib/db/types";
import { rateLimit } from "@/lib/api/rate-limit";
import { track } from "@/lib/analytics";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const projects = await listProjectsForOwner(user.id);
  return json({ projects });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await rateLimit(`projects:create:${user.id}`, 50, 3600);
  const body = await readJson(req, (d) => createProjectSchema.parse(d));
  const [project] = await db()<ProjectRow[]>`
    insert into projects (owner_id, title, visibility) values (${user.id}, ${body.title}, ${body.visibility}) returning *`;
  await track("project_created", { projectId: project.id, userId: user.id });
  return json({ project }, { status: 201 });
});
