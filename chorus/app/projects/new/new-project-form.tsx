"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { api } from "@/lib/api/client";
import type { ProjectRow } from "@/lib/db/types";

export function NewProjectForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!attested) return setError("Confirm that you have the rights to this text before uploading.");
    if (mode === "file" && !file) return setError("Choose a manuscript file.");
    if (mode === "paste" && text.trim().length === 0) return setError("Paste the manuscript text.");
    setBusy(true);
    try {
      const { project } = await api.post<{ project: ProjectRow }>("/api/projects", { title: title.trim() || (file?.name.replace(/\.[^.]+$/, "") ?? "Untitled") });
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("file", file);
        form.append("rights_attested", "true");
        await api.post(`/api/projects/${project.id}/upload`, form);
      } else {
        await api.post(`/api/projects/${project.id}/upload`, { text, rights_attested: true });
      }
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border border-line bg-surface p-6">
      <div>
        <Label htmlFor="title" hint="You can change this later.">
          Title
        </Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Little Women" maxLength={200} />
      </div>

      <div>
        <div className="flex gap-4 border-b border-line text-sm">
          {(["file", "paste"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setMode(m)} className={`-mb-px border-b-2 pb-2 ${mode === m ? "border-ink" : "border-transparent text-muted"}`}>
              {m === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>
        {mode === "file" ? (
          <div className="mt-4">
            <Label htmlFor="file" hint=".txt, .md, .docx, .epub or .pdf, up to 25 MB">
              Manuscript file
            </Label>
            <input id="file" type="file" accept=".txt,.md,.docx,.epub,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface-strong file:px-3 file:py-1.5" />
          </div>
        ) : (
          <div className="mt-4">
            <Label htmlFor="text" hint="Chapter headings like “Chapter 1” help Chorus split the book.">
              Manuscript text
            </Label>
            <Textarea id="text" rows={12} value={text} onChange={(e) => setText(e.target.value)} className="script-text" />
          </div>
        )}
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-1" />
        <span>
          I confirm that I wrote this text, it is in the public domain, or I otherwise hold the rights to record and distribute it. Chorus does not accept
          copyrighted books you do not have permission to use.
        </span>
      </label>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy} size="lg">
          {busy ? "Uploading" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
