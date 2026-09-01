import { getProject } from "@/lib/db/projects";
import { db } from "@/lib/db/client";
import type { CastingInviteRow } from "@/lib/db/types";
import { SettingsForm } from "./settings-form";
import { InvitesPanel } from "./invites";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await getProject(id))!;
  const invites = await db()<(CastingInviteRow & { character_name: string | null })[]>`
    select i.*, c.canonical_name as character_name from casting_invites i left join characters c on c.id = i.character_id
    where i.project_id = ${id} and i.revoked_at is null and (i.expires_at is null or i.expires_at > now()) order by i.created_at desc`;
  return (
    <div className="max-w-2xl space-y-10">
      <SettingsForm project={project} />
      <InvitesPanel initial={invites} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />
    </div>
  );
}
