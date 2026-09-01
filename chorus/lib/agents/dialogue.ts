/**
 * Deterministic dialogue detection (§4.3 pre-pass). Splits a paragraph into alternating
 * narration / dialogue spans based on quotation marks or leading em-dash dialogue.
 */
export interface Span {
  type: "narration" | "dialogue";
  text: string;
}

const OPEN_DOUBLE = new Set(['"', "“", "«", "„"]);
const CLOSE_DOUBLE = new Set(['"', "”", "»"]);
const OPEN_SINGLE = "‘";
const CLOSE_SINGLE = "’";

function pushSpan(spans: Span[], type: Span["type"], text: string) {
  const t = text.trim();
  if (!t) return;
  const last = spans[spans.length - 1];
  if (last && last.type === type) last.text = `${last.text} ${t}`;
  else spans.push({ type, text: t });
}

/** Returns true when the paragraph contains any candidate dialogue. */
export function hasDialogue(paragraph: string): boolean {
  return splitDialogue(paragraph).some((s) => s.type === "dialogue");
}

export function splitDialogue(paragraph: string): Span[] {
  const text = paragraph.trim();
  if (!text) return [];

  // Em-dash dialogue style: "— Where are you going? — she asked."
  if (/^[—–-]\s*\S/.test(text) && !/^-{2,}/.test(text)) {
    const body = text.replace(/^[—–-]\s*/, "");
    const parts = body.split(/\s[—–]\s/);
    const spans: Span[] = [];
    parts.forEach((part, i) => pushSpan(spans, i % 2 === 0 ? "dialogue" : "narration", part));
    return spans;
  }

  const spans: Span[] = [];
  let buf = "";
  let inQuote: "double" | "single" | null = null;
  const usesCurlySingle = text.includes(OPEN_SINGLE) && text.includes(CLOSE_SINGLE);
  const usesDouble = [...text].some((c) => OPEN_DOUBLE.has(c));
  const singleAsDialogue = !usesDouble && usesCurlySingle;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : " ";
    if (inQuote === null) {
      if (OPEN_DOUBLE.has(ch)) {
        pushSpan(spans, "narration", buf);
        buf = "";
        inQuote = "double";
        continue;
      }
      if (singleAsDialogue && ch === OPEN_SINGLE && /[\s(—-]/.test(prev)) {
        pushSpan(spans, "narration", buf);
        buf = "";
        inQuote = "single";
        continue;
      }
      buf += ch;
    } else if (inQuote === "double") {
      if (CLOSE_DOUBLE.has(ch)) {
        pushSpan(spans, "dialogue", buf);
        buf = "";
        inQuote = null;
        continue;
      }
      buf += ch;
    } else {
      const next = text[i + 1] ?? " ";
      if (ch === CLOSE_SINGLE && !/[A-Za-z]/.test(next)) {
        pushSpan(spans, "dialogue", buf);
        buf = "";
        inQuote = null;
        continue;
      }
      buf += ch;
    }
  }
  // Unterminated quote: multi-paragraph speech omits the closing mark, so the remainder is dialogue.
  pushSpan(spans, inQuote ? "dialogue" : "narration", buf);
  return spans;
}

/** Speech verbs used to spot explicit speaker tags and emotion cues in narration. */
export const SPEECH_VERBS =
  "said|says|asked|asks|replied|replies|answered|answers|shouted|shouts|whispered|whispers|muttered|mutters|cried|cries|called|calls|snapped|snaps|hissed|hisses|murmured|murmurs|yelled|yells|exclaimed|exclaims|added|adds|continued|continues|began|begins|laughed|laughs|sighed|sighs|growled|growls|grumbled|grumbles|breathed|breathes|gasped|gasps|demanded|demands|insisted|insists|protested|protests|admitted|admits|agreed|agrees|announced|announces|declared|declares|repeated|repeats|pleaded|pleads|screamed|screams|sobbed|sobs|stammered|stammers|shrugged|observed|remarked|remarks|interrupted|interrupts|offered|offers|suggested|suggests|warned|warns|urged|urges|roared|roars|barked|barks|chuckled|chuckles|grinned|grins|scoffed|scoffs|sneered|sneers|spat|spits|choked|chokes|told|tells|wondered|wonders|mused|muses|drawled|drawls|purred|purrs|groaned|groans|moaned|moans|coughed|hummed|sang|sings";

const speechVerbRe = new RegExp(`\\b(${SPEECH_VERBS})\\b`, "i");

/**
 * Finds a capitalised name adjacent to a speech verb in a narration span, e.g.
 * `said Mara`, `Mara said`, `, she said` (returns null for pronouns).
 */
export function explicitSpeakerName(narration: string): string | null {
  const name = "([A-Z][\\w'\\-]+(?:\\s+[A-Z][\\w'\\-]+){0,2})";
  const verbs = `(?:${SPEECH_VERBS})`;
  const patterns = [
    new RegExp(`\\b${verbs}\\s+(?:old\\s+|young\\s+|little\\s+)?${name}`),
    new RegExp(`${name}\\s+(?:\\w+\\s){0,2}?${verbs}\\b`),
  ];
  for (const re of patterns) {
    const m = narration.match(re);
    if (m?.[1]) {
      const candidate = m[1].replace(/^(The|A|An|Old|Young|Little|Miss|Mr|Mrs|Ms|Dr)\s+/, "").trim();
      if (candidate && !/^(He|She|They|It|I|We|You|The|And|But|Then)$/.test(candidate)) return candidate;
    }
  }
  return null;
}

export function hasSpeechVerb(narration: string): boolean {
  return speechVerbRe.test(narration);
}
