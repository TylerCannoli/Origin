import { handle, json } from "@/lib/api/errors";
import { resolveInvite } from "@/lib/db/invites";
import { loadCharacterCues } from "@/lib/db/recordings";
import { listCharacters } from "@/lib/db/characters";
import { getSessionUser } from "@/lib/auth/server";
import { rateLimit, clientIp } from "@/lib/api/rate-limit";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/api/errors";
import type { CharacterRow } from "@/lib/db/types";

type Ctx = { params: Promise<{ token: string }> };

/**
 * (public/token) Character + assigned cues for the recording interface. For a project-wide
 * link, pass ?character_id= to pick a part; without it the response lists the available parts.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { token } = await params;
  await rateLimit(`record:get:${clientIp(req)}`, 120, 60);
  const { invite, project, character } = await resolveInvite(token);
  const user = await getSessionUser(req);
  const url = new URL(req.url);
  let selected: CharacterRow | null = character;
  if (!selected) {
    const wanted = url.searchParams.get("character_id");
    if (wanted) {
      const [c] = await db()<CharacterRow[]>`select * from characters where id = ${wanted} and project_id = ${project.id} and merged_into_id is null and not is_excluded`;
      if (!c) throw new ApiError(404, "That character is not available on this link");
      selected = c;
    }
  }
  if (!selected) {
    const characters = (await listCharacters(project.id)).filter((c) => !c.is_excluded);
    return json({ project: { id: project.id, title: project.title }, invite: { scope: "project", expires_at: invite.expires_at }, characters, viewer: user ? { id: user.id, email: user.email } : null });
  }
  const chapters = await loadCharacterCues(selected.id);
  // Guests only see their own takes; the owner sees everything.
  const mine = (r: { recorded_by_user_id: string | null; guest_session_token: string | null }) =>
    (user && (r.recorded_by_user_id === user.id || user.id === project.owner_id)) || r.guest_session_token === token;
  const scoped = chapters.map((ch) => ({ ...ch, cues: ch.cues.map((c) => ({ ...c, recordings: c.recordings.filter(mine), recorded_by_others: c.recordings.some((r) => !mine(r)) })) }));
  const total = scoped.reduce((n, ch) => n + ch.cues.length, 0);
  const recorded = scoped.reduce((n, ch) => n + ch.cues.filter((c) => c.recordings.length > 0 || c.recorded_by_others).length, 0);
  return json({
    project: { id: project.id, title: project.title },
    invite: { scope: character ? "character" : "project", expires_at: invite.expires_at },
    character: { id: selected.id, canonical_name: selected.canonical_name, aliases: selected.aliases, blurb: selected.blurb, is_narrator: selected.is_narrator },
    chapters: scoped,
    progress: { recorded, total },
    viewer: user ? { id: user.id, email: user.email } : null,
  });
});
