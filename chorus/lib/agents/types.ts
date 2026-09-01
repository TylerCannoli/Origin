/**
 * Client-safe types shared between the web app and the worker. These mirror the agent
 * output contracts in the spec (§4.1–§4.4) and are persisted as JSON in the database.
 */

export interface ManuscriptParagraph {
  id: string; // p_0001
  text: string;
}

export interface ManuscriptChapter {
  id: string; // ch_001
  title: string;
  paragraphs: ManuscriptParagraph[];
}

/** Output of the Ingestion Agent (§4.1). */
export interface Manuscript {
  chapters: ManuscriptChapter[];
}

export type AgeRange = "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "elderly";
export type GenderPresentation = "female" | "male" | "neutral";

export interface ExtractedCharacter {
  id: string; // char_001 (stable within the extraction run)
  canonical_name: string;
  aliases: string[];
  blurb: string;
  inferred_age_range: AgeRange | null;
  inferred_gender_presentation: GenderPresentation | null;
  confidence: number;
}

/** Output of the Character Extraction Agent (§4.2). */
export interface CharacterRoster {
  characters: ExtractedCharacter[];
  narrator: { id: "char_narrator"; canonical_name: "Narrator" };
}

export type LineType = "narration" | "dialogue";

/** One attributed segment (§4.3). */
export interface AttributedLine {
  id: string; // line_00042
  chapter_id: string;
  paragraph_id: string;
  order: number;
  type: LineType;
  speaker_id: string | null; // roster character id, or null when needs_review
  text: string;
  confidence: number;
  needs_review: boolean;
}

export interface AttributionResult {
  lines: AttributedLine[];
}

export interface ScriptCue {
  cue_id: string;
  type: LineType;
  text: string;
  character_id: string;
  delivery_note?: string | null;
  paragraph_id?: string;
  confidence?: number;
  needs_review?: boolean;
}

/** Output of the Script Segmentation Agent (§4.4), one per chapter. */
export interface ChapterScript {
  chapter_id: string;
  cues: ScriptCue[];
}

export const PIPELINE_STEP_LABELS: Record<string, string> = {
  ingest: "Reading manuscript",
  extract_characters: "Finding characters",
  attribute_dialogue: "Splitting dialogue",
  segment_script: "Building the script",
  cast_voices: "Casting voices",
  render_chapter: "Rendering chapters",
  render_book: "Assembling the audiobook",
};
