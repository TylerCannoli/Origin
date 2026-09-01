import { describe, expect, it } from "vitest";
import { pickVoice, scoreVoice } from "@/lib/agents/voice-scoring";
import { MOCK_VOICES } from "@/lib/tts/mock";
import { deliveryNoteFromNarration } from "@/worker/agents/scriptSegmentation";
import { styleFromDeliveryNote } from "@/lib/tts/elevenlabs";

describe("voice scoring", () => {
  it("prefers a narrative voice for the narrator", () => {
    const v = pickVoice(MOCK_VOICES, { isNarrator: true, age: null, gender: null, blurb: null }, new Set());
    expect(v?.descriptors).toContain("narrative");
  });
  it("matches gender and age and avoids reusing voices", () => {
    const profile = { isNarrator: false, age: "teen" as const, gender: "female" as const, blurb: "The quiet, shy middle sister." };
    const first = pickVoice(MOCK_VOICES, profile, new Set());
    expect(first?.id).toBe("mock-wren");
    const second = pickVoice(MOCK_VOICES, profile, new Set([first!.id]));
    expect(second?.id).not.toBe(first?.id);
    expect(second?.gender).toBe("female");
  });
  it("uses blurb tone and accent keywords", () => {
    const gruff = pickVoice(MOCK_VOICES, { isNarrator: false, age: "elderly", gender: "male", blurb: "A gruff old lighthouse keeper" }, new Set());
    expect(gruff?.id).toBe("mock-oswin");
    const irish = MOCK_VOICES.find((v) => v.id === "mock-bram")!;
    expect(scoreVoice(irish, { isNarrator: false, age: "adult", gender: "male", blurb: "a hearty Irish fisherman" }, new Set())).toBeGreaterThan(
      scoreVoice(irish, { isNarrator: false, age: "adult", gender: "male", blurb: "a quiet clerk" }, new Set()),
    );
  });
  it("returns null with an empty catalog", () => {
    expect(pickVoice([], { isNarrator: false, age: null, gender: null, blurb: null }, new Set())).toBeNull();
  });
});

describe("delivery notes", () => {
  it("extracts notes from explicit speech verbs and adverbs", () => {
    expect(deliveryNoteFromNarration("she snapped, crossing her arms.")).toBe("sharp, snapping");
    expect(deliveryNoteFromNarration("he whispered.")).toBe("whispered");
    expect(deliveryNoteFromNarration("Mara said quietly.")).toBe("soft, gentle");
    expect(deliveryNoteFromNarration("Tobias called back.")).toBe("called across a distance");
    expect(deliveryNoteFromNarration("Mara said.")).toBeNull();
  });
  it("maps notes to a style value", () => {
    expect(styleFromDeliveryNote("shouted")).toBeGreaterThan(styleFromDeliveryNote("whispered"));
    expect(styleFromDeliveryNote(null)).toBeLessThan(0.3);
  });
});
