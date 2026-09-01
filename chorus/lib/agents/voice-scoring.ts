import type { Voice, VoiceAge } from "@/lib/tts/types";
import type { AgeRange, GenderPresentation } from "@/lib/agents/types";

export interface CastingProfile {
  isNarrator: boolean;
  age: AgeRange | null;
  gender: GenderPresentation | null;
  blurb: string | null;
}

const AGE_ORDER: VoiceAge[] = ["child", "teen", "young_adult", "adult", "middle_aged", "elderly"];

/** Blurb keywords -> voice descriptor tags. */
const TONE_MAP: [RegExp, string[]][] = [
  [/\b(warm|kind|gentle|soft-spoken|tender|motherly|fatherly)\b/i, ["warm", "gentle", "soft"]],
  [/\b(shy|quiet|timid|meek|soft)\b/i, ["soft", "shy", "gentle"]],
  [/\b(gruff|gravelly|rough|harsh|grumpy|surly)\b/i, ["gravelly", "gruff", "rough"]],
  [/\b(stern|strict|severe|formal|precise|prim)\b/i, ["stern", "precise", "authoritative"]],
  [/\b(cheerful|bright|bubbly|lively|energetic|playful|mischievous)\b/i, ["bright", "energetic", "playful"]],
  [/\b(dry|sarcastic|wry|sardonic|deadpan)\b/i, ["dry", "sardonic", "cool"]],
  [/\b(command|authorit|leader|captain|officer|boss)/i, ["authoritative", "commanding", "confident"]],
  [/\b(calm|measured|steady|thoughtful|wise)\b/i, ["calm", "measured", "even"]],
  [/\b(big|booming|loud|hearty|jovial)\b/i, ["big", "hearty"]],
  [/\b(old|elderly|aged|weathered|frail)\b/i, ["weathered", "slow", "dry"]],
  [/\b(young|youthful|child|boy|girl|kid)\b/i, ["youthful"]],
  [/\b(smooth|suave|charming|silky)\b/i, ["smooth", "cool"]],
];

const ACCENT_MAP: [RegExp, string][] = [
  [/\b(british|english|london|cockney|posh)\b/i, "british"],
  [/\b(irish|dublin)\b/i, "irish"],
  [/\b(scottish|scots|glasgow)\b/i, "scottish"],
  [/\b(american|texan|southern|new york|boston)\b/i, "american"],
  [/\b(australian|aussie)\b/i, "australian"],
];

export function scoreVoice(voice: Voice, profile: CastingProfile, alreadyUsed: Set<string>): number {
  let score = 0;
  if (profile.isNarrator) {
    if (voice.descriptors.some((d) => ["narrative", "calm", "measured", "even", "warm"].includes(d))) score += 3;
    if (voice.age === "adult" || voice.age === "middle_aged") score += 1;
  }
  if (profile.gender && voice.gender) {
    if (profile.gender === voice.gender) score += 3;
    else if (voice.gender === "neutral" || profile.gender === "neutral") score += 1;
    else score -= 2;
  }
  if (profile.age && voice.age) {
    const d = Math.abs(AGE_ORDER.indexOf(profile.age) - AGE_ORDER.indexOf(voice.age));
    score += d === 0 ? 2 : d === 1 ? 1 : d >= 3 ? -1.5 : 0;
  }
  const blurb = profile.blurb ?? "";
  for (const [re, tags] of TONE_MAP) {
    if (re.test(blurb) && voice.descriptors.some((d) => tags.includes(d))) score += 1;
  }
  for (const [re, accent] of ACCENT_MAP) {
    if (re.test(blurb) && voice.accent === accent) score += 1.5;
  }
  if (alreadyUsed.has(voice.id)) score -= 4; // strongly prefer a distinct voice per character
  return score;
}

/** Picks the best-scoring voice for a profile; ties broken by catalog order for determinism. */
export function pickVoice(voices: Voice[], profile: CastingProfile, alreadyUsed: Set<string>): Voice | null {
  if (voices.length === 0) return null;
  let best: Voice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v, profile, alreadyUsed);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}
