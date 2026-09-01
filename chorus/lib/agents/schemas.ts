import { z } from "zod";

/** Structured-output schemas for every LLM call in the pipeline. Shared by the real and fake providers. */

export const ageRangeSchema = z.enum(["child", "teen", "young_adult", "adult", "middle_aged", "elderly"]);
export const genderSchema = z.enum(["female", "male", "neutral"]);

export const chapterSplitResponse = z.object({
  splits: z.array(
    z.object({
      paragraph_index: z.number().int().min(0).describe("Index of the paragraph that begins a new chapter"),
      title: z.string().describe("Short chapter title"),
    }),
  ),
});
export type ChapterSplitResponse = z.infer<typeof chapterSplitResponse>;

export const chunkExtractionResponse = z.object({
  characters: z.array(
    z.object({
      name: z.string().describe("Most complete name used for this character in the chunk"),
      aliases: z.array(z.string()).describe("Other names, nicknames or epithets used for the same person in this chunk"),
      description: z.string().describe("One sentence about who they are and how they speak, using only what the text shows"),
      speaks: z.boolean().describe("True if the character has spoken dialogue in this chunk"),
    }),
  ),
});
export type ChunkExtractionResponse = z.infer<typeof chunkExtractionResponse>;

export const reconcileResponse = z.object({
  characters: z.array(
    z.object({
      canonical_name: z.string(),
      aliases: z.array(z.string()),
      blurb: z.string().describe("1-2 sentences about voice-relevant traits: age impression, tone, formality, accent hints if stated"),
      inferred_age_range: ageRangeSchema.nullable(),
      inferred_gender_presentation: genderSchema.nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ReconcileResponse = z.infer<typeof reconcileResponse>;

export const attributionResponse = z.object({
  segments: z.array(
    z.object({
      segment_id: z.string(),
      is_dialogue: z.boolean().describe("False if the quoted span is not spoken dialogue (a title, scare quotes, a sign, a thought marked as such)"),
      speaker_id: z.string().nullable().describe("Roster character id of the speaker; null when it cannot be determined"),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type AttributionResponse = z.infer<typeof attributionResponse>;

export const deliveryNotesResponse = z.object({
  notes: z.array(z.object({ line_id: z.string(), note: z.string().describe("At most 6 words of acting direction") })),
});
export type DeliveryNotesResponse = z.infer<typeof deliveryNotesResponse>;

export const voiceRationaleResponse = z.object({ rationale: z.string() });
export type VoiceRationaleResponse = z.infer<typeof voiceRationaleResponse>;
