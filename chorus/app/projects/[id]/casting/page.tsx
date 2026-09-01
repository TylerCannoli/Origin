import { listCharacters } from "@/lib/db/characters";
import { getProject } from "@/lib/db/projects";
import { createTTS } from "@/lib/tts";
import { EmptyState } from "@/components/ui/notice";
import { ButtonLink } from "@/components/ui/button";
import { CastingBoard } from "@/components/casting-board/casting-board";

export default async function CastingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await getProject(id))!;
  const characters = await listCharacters(id);
  let voices: Awaited<ReturnType<ReturnType<typeof createTTS>["listVoices"]>> = [];
  let voiceError: string | null = null;
  try {
    voices = await createTTS().listVoices();
  } catch (err) {
    voiceError = err instanceof Error ? err.message : "Voice library unavailable";
  }

  if (characters.length === 0) {
    return (
      <EmptyState
        title={project.status === "processing" ? "Still finding characters" : "No characters yet"}
        body={project.status === "processing" ? "The casting board fills in as soon as processing finishes." : "Upload a manuscript to build the cast list."}
        action={<ButtonLink href={`/projects/${id}`} variant="secondary">Back to overview</ButtonLink>}
      />
    );
  }
  return <CastingBoard projectId={id} initialCharacters={characters} voices={voices} voiceError={voiceError} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />;
}
