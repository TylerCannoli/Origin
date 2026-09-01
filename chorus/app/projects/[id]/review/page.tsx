import { loadReviewQueue } from "@/lib/db/script";
import { listCharacters } from "@/lib/db/characters";
import { EmptyState } from "@/components/ui/notice";
import { ButtonLink } from "@/components/ui/button";
import { ReviewQueue } from "./review-queue";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [cues, characters] = await Promise.all([loadReviewQueue(id), listCharacters(id)]);
  if (cues.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        body="Every line has a speaker. Lines Chorus is unsure about will show up here for you to assign."
        action={<ButtonLink href={`/projects/${id}/casting`} variant="secondary">Go to the casting board</ButtonLink>}
      />
    );
  }
  return <ReviewQueue projectId={id} initialCues={cues} characters={characters.filter((c) => !c.is_excluded)} />;
}
