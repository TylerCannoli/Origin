import Link from "next/link";
import { db } from "@/lib/db/client";
import { listCharacters } from "@/lib/db/characters";
import { EmptyState } from "@/components/ui/notice";
import { ButtonLink } from "@/components/ui/button";
import { TakesReview } from "./takes-review";
import type { RecordingRow } from "@/lib/db/types";

export interface TakeRow extends RecordingRow {
  cue_text: string;
  cue_type: string;
  character_name: string;
  character_id: string;
  chapter_title: string | null;
  recorder_email: string | null;
}

/** Owner view of every submitted take, grouped by character, with approve / reject controls. */
export default async function TakesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ character?: string }> }) {
  const { id } = await params;
  const { character } = await searchParams;
  const characters = await listCharacters(id);
  const sql = db();
  const takes = await sql<TakeRow[]>`
    select r.*, cu.text as cue_text, cu.type as cue_type, c.canonical_name as character_name, c.id as character_id, ch.title as chapter_title, u.email as recorder_email
    from recordings r join cues cu on cu.id = r.cue_id join characters c on c.id = cu.character_id join chapters ch on ch.id = cu.chapter_id
    left join users u on u.id = r.recorded_by_user_id
    where ch.project_id = ${id} ${character ? sql`and c.id = ${character}` : sql``}
    order by ch.order_index, cu.order_index, r.created_at desc`;
  if (takes.length === 0) {
    return (
      <EmptyState
        title="No takes yet"
        body="Takes show up here as soon as someone records a line. Approve the ones you like; rejected takes are skipped when the audiobook is generated."
        action={<ButtonLink href={`/projects/${id}/casting`} variant="secondary">Invite readers</ButtonLink>}
      />
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">Filter:</span>
        <Link href={`/projects/${id}/takes`} className={!character ? "underline" : "text-muted hover:text-ink"}>
          Everyone
        </Link>
        {characters
          .filter((c) => c.recorded_count > 0)
          .map((c) => (
            <Link key={c.id} href={`/projects/${id}/takes?character=${c.id}`} className={character === c.id ? "underline" : "text-muted hover:text-ink"}>
              {c.canonical_name}
            </Link>
          ))}
      </div>
      <TakesReview initialTakes={takes} />
    </div>
  );
}
