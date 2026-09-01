import { z } from "zod";

export const uuid = z.string().uuid();

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Give your project a title").max(200),
  visibility: z.enum(["private", "invite_only", "public_listen"]).default("private"),
});

export const updateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: z.enum(["private", "invite_only", "public_listen"]).optional(),
    pacing: z.enum(["tight", "normal", "relaxed"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const pasteUploadSchema = z.object({
  text: z.string().min(1, "Paste some text first"),
  rights_attested: z.literal(true, { message: "You must confirm you have the rights to this text" }),
  title: z.string().trim().max(200).optional(),
});

export const SUPPORTED_UPLOAD_EXTENSIONS = ["txt", "md", "docx", "epub", "pdf"] as const;
export type UploadExtension = (typeof SUPPORTED_UPLOAD_EXTENSIONS)[number];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_MANUSCRIPT_WORDS = 400_000;

export const updateCharacterSchema = z
  .object({
    canonical_name: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    blurb: z.string().trim().max(600).nullable().optional(),
    inferred_age_range: z.enum(["child", "teen", "young_adult", "adult", "middle_aged", "elderly"]).nullable().optional(),
    inferred_gender_presentation: z.enum(["female", "male", "neutral"]).nullable().optional(),
    is_excluded: z.boolean().optional(),
    ai_voice_id: z.string().trim().min(1).max(120).nullable().optional(),
    claimed_by_user_id: z.string().uuid().nullable().optional(),
    claim_self: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const mergeCharacterSchema = z.object({ into_character_id: uuid });

export const updateCueSchema = z
  .object({
    character_id: uuid.optional(),
    delivery_note: z.string().trim().max(80).nullable().optional(),
    text: z.string().trim().min(1).max(5000).optional(),
    needs_review: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const setVoiceSchema = z.object({ ai_voice_id: z.string().trim().min(1).max(120) });

export const auditionSchema = z.object({
  voice_id: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(300).optional(),
  delivery_note: z.string().trim().max(80).optional(),
});

export const inviteSchema = z.object({
  expires_in_days: z.number().int().min(1).max(365).default(30),
});

export const recordingStatusSchema = z.object({ status: z.enum(["approved", "rejected", "submitted"]) });

export const renderSchema = z.object({
  chapter_ids: z.array(uuid).optional(),
  force: z.boolean().optional(),
});
