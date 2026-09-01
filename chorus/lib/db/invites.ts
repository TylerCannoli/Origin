import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api/errors";
import type { CastingInviteRow, CharacterRow, ProjectRow } from "@/lib/db/types";

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createInvite(projectId: string, characterId: string | null, expiresInDays: number): Promise<CastingInviteRow & { link: string }> {
  const token = newInviteToken();
  const expires = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);
  const [row] = await db()<CastingInviteRow[]>`
    insert into casting_invites (project_id, character_id, token, expires_at) values (${projectId}, ${characterId}, ${token}, ${expires}) returning *`;
  return { ...row, link: inviteLink(token) };
}

export const inviteLink = (token: string) => `${env.appUrl}/record/${token}`;

export interface ResolvedInvite {
  invite: CastingInviteRow;
  project: ProjectRow;
  /** The invited character, or null for a project-wide casting link. */
  character: CharacterRow | null;
}

/** Validates a casting token (exists, not revoked, not expired). Throws ApiError(404/410). */
export async function resolveInvite(token: string): Promise<ResolvedInvite> {
  const sql = db();
  const [invite] = await sql<CastingInviteRow[]>`select * from casting_invites where token = ${token}`;
  if (!invite) throw new ApiError(404, "This casting link is not valid");
  if (invite.revoked_at) throw new ApiError(410, "This casting link has been turned off by the project owner");
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) throw new ApiError(410, "This casting link has expired. Ask the project owner for a new one.");
  const [project] = await sql<ProjectRow[]>`select * from projects where id = ${invite.project_id}`;
  if (!project) throw new ApiError(404, "This project no longer exists");
  let character: CharacterRow | null = null;
  if (invite.character_id) {
    const [c] = await sql<CharacterRow[]>`select * from characters where id = ${invite.character_id}`;
    if (!c || c.merged_into_id) throw new ApiError(410, "This character was merged into another; ask the project owner for a new link");
    character = c;
  }
  return { invite, project, character };
}
