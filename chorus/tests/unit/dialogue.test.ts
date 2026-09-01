import { describe, expect, it } from "vitest";
import { explicitSpeakerName, splitDialogue } from "@/lib/agents/dialogue";

describe("splitDialogue", () => {
  it("splits mixed narration and dialogue in original order", () => {
    expect(splitDialogue('"I won\'t," she said, crossing her arms.')).toEqual([
      { type: "dialogue", text: "I won't," },
      { type: "narration", text: "she said, crossing her arms." },
    ]);
  });
  it("handles curly quotes and multiple spans", () => {
    expect(splitDialogue("“Then I’ll burn through it,” Mara said. “There are boats out there.”")).toEqual([
      { type: "dialogue", text: "Then I’ll burn through it," },
      { type: "narration", text: "Mara said." },
      { type: "dialogue", text: "There are boats out there." },
    ]);
  });
  it("treats an unterminated quote as dialogue to the end", () => {
    expect(splitDialogue('"This speech goes on for several paragraphs.')).toEqual([{ type: "dialogue", text: "This speech goes on for several paragraphs." }]);
  });
  it("returns pure narration untouched", () => {
    expect(splitDialogue("The storm came in off the water.")).toEqual([{ type: "narration", text: "The storm came in off the water." }]);
  });
  it("supports em-dash dialogue", () => {
    expect(splitDialogue("— Where are you going? — she asked.")).toEqual([
      { type: "dialogue", text: "Where are you going?" },
      { type: "narration", text: "she asked." },
    ]);
  });
  it("supports curly single-quote dialogue without breaking on apostrophes", () => {
    expect(splitDialogue("‘It’s late,’ said Tom.")).toEqual([
      { type: "dialogue", text: "It’s late," },
      { type: "narration", text: "said Tom." },
    ]);
  });
});

describe("explicitSpeakerName", () => {
  it("finds verb-first and name-first tags", () => {
    expect(explicitSpeakerName("said Mara.")).toBe("Mara");
    expect(explicitSpeakerName("Tobias called back.")).toBe("Tobias");
    expect(explicitSpeakerName("Old Tobias Quill said, leaning on his cane.")).toBe("Tobias Quill");
    expect(explicitSpeakerName("said her grandfather from the foot of the stairs.")).toBeNull();
  });
  it("ignores pronouns", () => {
    expect(explicitSpeakerName("she said quietly.")).toBeNull();
  });
});
