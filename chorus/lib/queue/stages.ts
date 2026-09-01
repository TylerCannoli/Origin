import type { PipelineStage } from "@/lib/db/types";

/** Client-safe stage ordering (no Redis imports). */
export const PROCESSING_STAGES: PipelineStage[] = ["ingest", "extract_characters", "attribute_dialogue", "segment_script", "cast_voices"];
