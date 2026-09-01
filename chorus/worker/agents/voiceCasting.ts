import type { Sql } from "postgres";
import type { LLM } from "@/lib/llm/types";
import type { TTSProvider } from "@/lib/tts/types";
import type { CharacterRow } from "@/lib/db/types";
import { pickVoice } from "@/lib/agents/voice-scoring";
import { voiceRationaleResponse } from "@/lib/agents/schemas";

export interface VoiceCastingDeps {
  sql: Sql;
  llm: LLM;
  tts: TTSProvider;
  /** Skip the optional "why this voice" LLM call. */
  skipRationale?: boolean;
}

/**
 * Voice Casting Agent (§4.5): rules-based match of each character to the provider's voice
 * library, keeping user overrides. The one-sentence rationale is optional polish via the LLM.
 */
export async function runVoiceCasting(deps: VoiceCastingDeps, input: { project_id: string; force?: boolean }): Promise<{ assigned: number }> {
  const { sql, tts, llm } = deps;
  const voices = await tts.listVoices();
  const characters = await sql<(CharacterRow & { line_count: number })[]>`
    select c.*, (select count(*)::int from cues cu where cu.character_id = c.id) as line_count
    from characters c where c.project_id = ${input.project_id} and c.merged_into_id is null
    order by c.is_narrator desc, line_count desc, c.created_at`;

  const used = new Set<string>(characters.filter((c) => c.ai_voice_id && !input.force).map((c) => c.ai_voice_id!));
  let assigned = 0;
  for (const c of characters) {
    // Idempotent: only (re)assign characters without a voice unless forced.
    if (c.ai_voice_id && !input.force) continue;
    const voice = pickVoice(
      voices,
      { isNarrator: c.is_narrator, age: c.inferred_age_range as never, gender: c.inferred_gender_presentation as never, blurb: c.blurb },
      used,
    );
    if (!voice) continue;
    used.add(voice.id);
    let rationale: string | null = null;
    if (!deps.skipRationale) {
      try {
        const { data } = await llm.complete({
          agent: "voice_casting.rationale",
          projectId: input.project_id,
          tier: "fast",
          effort: "low",
          maxTokens: 200,
          system: "You write one short sentence explaining why a synthetic voice suits a book character, for a casting board. Plain, friendly, no hype.",
          instruction: "Explain this voice choice in one sentence.",
          input: {
            character: { name: c.canonical_name, blurb: c.blurb, age: c.inferred_age_range, gender: c.inferred_gender_presentation, is_narrator: c.is_narrator },
            voice: { name: voice.name, age: voice.age, gender: voice.gender, accent: voice.accent, descriptors: voice.descriptors },
          },
          schema: voiceRationaleResponse,
        });
        rationale = data.rationale.trim().slice(0, 300);
      } catch {
        rationale = null; // optional polish; never block casting on it
      }
    }
    await sql`update characters set ai_voice_id = ${voice.id}, voice_rationale = ${rationale} where id = ${c.id}`;
    assigned++;
  }
  return { assigned };
}
