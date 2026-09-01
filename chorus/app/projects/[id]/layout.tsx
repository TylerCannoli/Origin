import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/lib/auth/server";
import { getProject } from "@/lib/db/projects";
import { ProjectNav } from "@/components/project-nav";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const project = await getProject(id);
  if (!project || project.owner_id !== user.id) notFound();
  return (
    <>
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
              All projects
            </Link>
            <h1 className="mt-1 text-4xl">{project.title}</h1>
          </div>
        </div>
        <ProjectNav projectId={project.id} />
        <main className="mt-8">{children}</main>
      </div>
    </>
  );
}
