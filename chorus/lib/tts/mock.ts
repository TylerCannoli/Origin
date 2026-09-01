import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFmpeg } from "@/lib/audio/ffmpeg";
import type { SynthesizeRequest, SynthesizeResult, TTSProvider, Voice } from "@/lib/tts/types";

/** A small catalog with varied metadata so the casting scorer has something to choose between. */
export const MOCK_VOICES: Voice[] = [
  { id: "mock-marlowe", name: "Marlowe", gender: "male", age: "middle_aged", accent: "british", descriptors: ["warm", "narrative", "calm", "measured"] },
  { id: "mock-harriet", name: "Harriet", gender: "female", age: "adult", accent: "british", descriptors: ["warm", "narrative", "clear", "gentle"] },
  { id: "mock-juno", name: "Juno", gender: "female", age: "young_adult", accent: "american", descriptors: ["bright", "energetic", "friendly"] },
  { id: "mock-wren", name: "Wren", gender: "female", age: "teen", accent: "american", descriptors: ["soft", "shy", "youthful", "gentle"] },
  { id: "mock-pip", name: "Pip", gender: "neutral", age: "child", accent: "american", descriptors: ["playful", "youthful", "curious"] },
  { id: "mock-ash", name: "Ash", gender: "male", age: "young_adult", accent: "american", descriptors: ["earnest", "eager", "clear"] },
  { id: "mock-bram", name: "Bram", gender: "male", age: "adult", accent: "irish", descriptors: ["gravelly", "gruff", "big", "hearty"] },
  { id: "mock-oswin", name: "Oswin", gender: "male", age: "elderly", accent: "british", descriptors: ["gruff", "dry", "weathered", "slow"] },
  { id: "mock-agatha", name: "Agatha", gender: "female", age: "elderly", accent: "british", descriptors: ["stern", "precise", "dry"] },
  { id: "mock-sable", name: "Sable", gender: "female", age: "middle_aged", accent: "american", descriptors: ["authoritative", "brisk", "confident", "commanding"] },
  { id: "mock-rook", name: "Rook", gender: "male", age: "middle_aged", accent: "american", descriptors: ["sardonic", "smooth", "cool"] },
  { id: "mock-lark", name: "Lark", gender: "neutral", age: "adult", accent: "neutral", descriptors: ["neutral", "calm", "narrative", "even"] },
];

/**
 * Mock provider for local development and tests: renders a tone burst whose length matches
 * the reading time of the text, at a pitch unique to the voice, so assembled audio is audibly
 * structured without calling a paid API.
 */
export class MockTTS implements TTSProvider {
  readonly name = "mock";
  constructor(private readonly ffmpeg = new FFmpeg()) {}

  async listVoices(): Promise<Voice[]> {
    return MOCK_VOICES;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const words = (req.text.match(/\S+/g) ?? []).length;
    const durationMs = Math.max(400, Math.round((words / 2.8) * 1000));
    const index = Math.max(0, MOCK_VOICES.findIndex((v) => v.id === req.voiceId));
    const frequency = 180 + index * 35;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chorus-mock-tts-"));
    const file = path.join(dir, "out.mp3");
    try {
      await this.ffmpeg.synthesizePlaceholder(file, { durationMs, frequency });
      return { audio: await fs.readFile(file), mimeType: "audio/mpeg" };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
