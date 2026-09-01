"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";

export function ProjectOverviewActions({ projectId, stage }: { projectId: string; stage: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="ml-2 underline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/api/projects/${projectId}/pipeline/retry`, { stage });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Retrying" : "Retry this step"}
    </button>
  );
}
