import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/notice";
import { getSessionUser } from "@/lib/auth/server";
import { listProjectsForOwner } from "@/lib/db/projects";
import { StatusBadge } from "@/components/pipeline/status-badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const projects = await listProjectsForOwner(user.id);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl">Your projects</h1>
            <p className="mt-1 text-muted">Signed in as {user.email}</p>
          </div>
          <ButtonLink href="/projects/new">New project</ButtonLink>
        </div>

        {projects.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title="No projects yet"
              body="Start with a manuscript you own or a public-domain novel. Chorus will find the characters and build the casting board."
              action={<ButtonLink href="/projects/new">Create your first project</ButtonLink>}
            />
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-surface p-5 hover:border-line-strong">
                <Link href={`/projects/${p.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-2xl">{p.title}</h2>
                    <StatusBadge status={p.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">Characters</dt>
                      <dd className="text-lg">{p.character_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Chapters</dt>
                      <dd className="text-lg">{p.chapter_count}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Lines recorded</dt>
                      <dd className="text-lg">
                        {p.recorded_cues}
                        <span className="text-muted"> / {p.total_cues}</span>
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
