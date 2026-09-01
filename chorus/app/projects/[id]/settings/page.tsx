import { getProject } from "@/lib/db/projects";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await getProject(id))!;
  return (
    <div className="max-w-2xl space-y-10">
      <SettingsForm project={project} />
    </div>
  );
}
