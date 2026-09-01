"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api/client";
import type { ProjectRow } from "@/lib/db/types";

export function SettingsForm({ project }: { project: ProjectRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(project.title);
  const [visibility, setVisibility] = useState(project.visibility);
  const [pacing, setPacing] = useState(project.pacing);
  const [file, setFile] = useState<File | null>(null);
  const [attested, setAttested] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/api/projects/${project.id}`, { title, visibility, pacing });
      setMsg({ tone: "success", text: "Saved." });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setMsg({ tone: "error", text: "Choose a file first." });
    if (!attested) return setMsg({ tone: "error", text: "Confirm the rights attestation first." });
    if (project.source_file_url && !confirm("Replacing the manuscript deletes all characters, lines and recordings for this project. Continue?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("rights_attested", "true");
      await api.post(`/api/projects/${project.id}/upload`, form);
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Upload failed" });
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this project and everything in it? This cannot be undone.")) return;
    await api.delete(`/api/projects/${project.id}`);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={save} className="space-y-5 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-2xl">Project settings</h2>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
        <div>
          <Label htmlFor="visibility" hint="Private projects are only visible to you. Invite-only lets invited readers see their own lines. Public listen makes the finished audiobook link work for anyone.">
            Visibility
          </Label>
          <Select id="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as ProjectRow["visibility"])}>
            <option value="private">Private</option>
            <option value="invite_only">Invite only</option>
            <option value="public_listen">Public listen link</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="pacing" hint="Controls the pauses between lines and around narration in the finished audio.">
            Pacing
          </Label>
          <Select id="pacing" value={pacing} onChange={(e) => setPacing(e.target.value as ProjectRow["pacing"])}>
            <option value="tight">Tight</option>
            <option value="normal">Normal</option>
            <option value="relaxed">Relaxed</option>
          </Select>
        </div>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button type="submit" disabled={busy}>
          Save changes
        </Button>
      </form>

      <form onSubmit={upload} className="space-y-5 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-2xl">{project.source_file_url ? "Replace the manuscript" : "Add the manuscript"}</h2>
        {project.source_file_url ? <p className="text-sm text-muted">Current source: {project.source_kind ?? "file"}. Replacing it starts processing again from scratch.</p> : null}
        <div>
          <Label htmlFor="file" hint=".txt, .md, .docx, .epub or .pdf, up to 25 MB">
            Manuscript file
          </Label>
          <input id="file" type="file" accept=".txt,.md,.docx,.epub,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-1" />
          <span>I confirm I hold the rights to record and distribute this text.</span>
        </label>
        <Button type="submit" variant="secondary" disabled={busy}>
          Upload and process
        </Button>
      </form>

      <div className="rounded-lg border border-danger/30 p-6">
        <h2 className="text-2xl">Delete project</h2>
        <p className="mt-1 text-sm text-muted">Removes the manuscript, cast, recordings and rendered audio.</p>
        <Button variant="danger" className="mt-4" onClick={remove} type="button">
          Delete this project
        </Button>
      </div>
    </>
  );
}
