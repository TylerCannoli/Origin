import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/lib/auth/server";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-4xl">New project</h1>
        <p className="mt-2 text-ink-soft">Name the book, then add the manuscript. Processing starts as soon as the upload finishes.</p>
        <div className="mt-8">
          <NewProjectForm />
        </div>
      </main>
    </>
  );
}
