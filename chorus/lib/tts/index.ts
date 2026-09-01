import { env } from "@/lib/env";
import { ElevenLabsTTS } from "@/lib/tts/elevenlabs";
import { MockTTS } from "@/lib/tts/mock";
import type { TTSProvider } from "@/lib/tts/types";

export type { TTSProvider, Voice } from "@/lib/tts/types";

let cached: TTSProvider | null = null;

/** Configured TTS provider (ElevenLabs or the offline mock). */
export function createTTS(): TTSProvider {
  if (cached) return cached;
  cached = env.ttsProvider === "elevenlabs" ? new ElevenLabsTTS(env.elevenLabs.apiKey, env.elevenLabs.modelId) : new MockTTS();
  return cached;
}

export function __setTTSForTests(p: TTSProvider | null) {
  cached = p;
}
