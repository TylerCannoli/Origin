export type ProjectStatus = "draft" | "processing" | "ready" | "error";
export type Visibility = "private" | "invite_only" | "public_listen";
export type Pacing = "tight" | "normal" | "relaxed";
export type ChapterStatus = "pending" | "attributed" | "segmented" | "rendered";
export type CueType = "narration" | "dialogue";
export type RecordingStatus = "submitted" | "approved" | "rejected";
export type PipelineStatus = "queued" | "running" | "complete" | "failed";
export type PipelineStage =
  | "ingest"
  | "extract_characters"
  | "attribute_dialogue"
  | "segment_script"
  | "cast_voices"
  | "render_chapter"
  | "render_book";

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  visibility: Visibility;
  rights_attested: boolean;
  source_file_url: string | null;
  status: ProjectStatus;
  pacing: Pacing;
  source_kind: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChapterRow {
  id: string;
  project_id: string;
  order_index: number;
  title: string | null;
  source_chapter_id: string | null;
  status: ChapterStatus;
}

export interface CharacterRow {
  id: string;
  project_id: string;
  canonical_name: string;
  aliases: string[];
  blurb: string | null;
  inferred_age_range: string | null;
  inferred_gender_presentation: string | null;
  ai_voice_id: string | null;
  is_narrator: boolean;
  claimed_by_user_id: string | null;
  is_excluded: boolean;
  merged_into_id: string | null;
  voice_rationale: string | null;
  confidence: number | null;
  created_at: string;
}

export interface CueRow {
  id: string;
  chapter_id: string;
  character_id: string;
  order_index: number;
  type: CueType;
  text: string;
  delivery_note: string | null;
  confidence: number | null;
  needs_review: boolean;
  paragraph_id: string | null;
}

export interface RecordingRow {
  id: string;
  cue_id: string;
  recorded_by_user_id: string | null;
  guest_session_token: string | null;
  audio_url: string;
  duration_ms: number | null;
  mime_type: string | null;
  status: RecordingStatus;
  created_at: string;
}

export interface RenderedAudioRow {
  id: string;
  chapter_id: string | null;
  project_id: string;
  scope: "chapter" | "full_book";
  audio_url: string;
  format: "mp3" | "m4b";
  duration_ms: number | null;
  chapter_markers: { title: string; start_ms: number }[] | null;
  rendered_at: string;
}

export interface PipelineRunRow {
  id: string;
  project_id: string;
  stage: PipelineStage;
  status: PipelineStatus;
  error: string | null;
  progress: { current?: number; total?: number; message?: string } | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AgentRunRow {
  id: string;
  project_id: string | null;
  agent_name: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  estimated_cost_usd: number | null;
  input_hash: string | null;
  status: "ok" | "error";
  error: string | null;
  created_at: string;
}

export interface CastingInviteRow {
  id: string;
  project_id: string;
  character_id: string | null;
  token: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
