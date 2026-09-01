import { Wave } from "@/components/ui/wave";

export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-10 text-muted">
      <Wave bars={8} live className="text-gold" />
      Loading
    </div>
  );
}
