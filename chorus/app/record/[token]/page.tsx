import Link from "next/link";
import { ApiError } from "@/lib/api/errors";
import { resolveInvite } from "@/lib/db/invites";
import { loadCharacterCues } from "@/lib/db/recordings";
import { listCharacters } from "@/lib/db/characters";
import { getSessionUser } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { Wave } from "@/components/ui/wave";
import { Notice } from "@/components/ui/notice";
import { RecordingStudio, type StudioData } from "@/components/recorder/recording-studio";
import type { CharacterRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg display">
            <Wave bars={7} className="text-gold" seed={5} />
            Chorus
          </Link>
          <span className="text-sm text-muted">Recording studio</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </>
  );
}

export default async function RecordPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ character?: string }> }) {
  const { token } = await params;
  const { character: wanted } = await searchParams;
  let resolved;
  try {
    resolved = await resolveInvite(token);
  } catch (err) {
    return (
      <Shell>
        <h1 className="text-3xl">This link doesn&apos;t work</h1>
        <p className="mt-2 text-ink-soft">{err instanceof ApiError ? err.message : "Something went wrong opening this casting link."}</p>
      </Shell>
    );
  }
  const { project, character: invited } = resolved;
  const user = await getSessionUser();
  let character: CharacterRow | null = invited;
  if (!character && wanted) {
    const [c] = await db()<CharacterRow[]>`select * from characters where id = ${wanted} and project_id = ${project.id} and merged_into_id is null and not is_excluded`;
    character = c ?? null;
  }

  if (!character) {
    const characters = (await listCharacters(project.id)).filter((c) => !c.is_excluded);
    return (
      <Shell>
        <div className="text-sm text-muted">{project.title}</div>
        <h1 className="text-4xl">Pick a part to read</h1>
        <p className="mt-2 text-ink-soft">Choose any character. You&apos;ll see only that character&apos;s lines, with notes on how to deliver them.</p>
        {characters.length === 0 ? (
          <div className="mt-6">
            <Notice tone="info">The cast list isn&apos;t ready yet. Check back soon.</Notice>
          </div>
        ) : null}
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {characters.map((c) => (
            <li key={c.id}>
              <Link href={`/record/${token}?character=${c.id}`} className="block rounded-lg border border-line bg-surface p-4 hover:border-line-strong">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xl display">{c.canonical_name}</span>
                  <span className="text-sm text-muted">
                    {c.recorded_count}/{c.line_count} lines
                  </span>
                </div>
                {c.blurb ? <p className="mt-1 text-sm text-ink-soft line-clamp-2">{c.blurb}</p> : null}
                {c.claimed_by_email ? <p className="mt-1 text-xs text-muted">Claimed by {c.claimed_by_email}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  const chapters = await loadCharacterCues(character.id);
  const mine = (r: { recorded_by_user_id: string | null; guest_session_token: string | null }) =>
    (user && (r.recorded_by_user_id === user.id || user.id === project.owner_id)) || r.guest_session_token === token;
  const scoped = chapters.map((ch) => ({ ...ch, cues: ch.cues.map((c) => ({ ...c, recordings: c.recordings.filter(mine), recorded_by_others: c.recordings.some((r) => !mine(r)) })) }));
  const total = scoped.reduce((n, ch) => n + ch.cues.length, 0);
  const recorded = scoped.reduce((n, ch) => n + ch.cues.filter((c) => c.recordings.length > 0 || c.recorded_by_others).length, 0);
  const initial: StudioData = {
    project: { id: project.id, title: project.title },
    invite: { scope: invited ? "character" : "project", expires_at: resolved.invite.expires_at },
    character: { id: character.id, canonical_name: character.canonical_name, aliases: character.aliases ?? [], blurb: character.blurb, is_narrator: character.is_narrator },
    chapters: scoped,
    progress: { recorded, total },
    viewer: user ? { id: user.id, email: user.email } : null,
  };
  return (
    <Shell>
      {!invited ? (
        <p className="mb-4 text-sm">
          <Link href={`/record/${token}`} className="text-muted hover:text-ink">
            Choose a different part
          </Link>
        </p>
      ) : null}
      <RecordingStudio token={token} initial={initial} characterQuery={invited ? "" : `?character_id=${character.id}`} />
    </Shell>
  );
}
