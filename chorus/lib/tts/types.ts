export type VoiceGender = "female" | "male" | "neutral";
export type VoiceAge = "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "elderly";

/** Provider-agnostic voice metadata used by the casting scorer and the voice picker. */
export interface Voice {
  id: string;
  name: string;
  gender: VoiceGender | null;
  age: VoiceAge | null;
  accent: string | null;
  /** Free-form tone tags, lower-case: "warm", "gravelly", "bright", "calm", "narrative"... */
  descriptors: string[];
  previewUrl?: string | null;
}

export interface SynthesizeRequest {
  text: string;
  voiceId: string;
  /** Short acting direction; providers map it to their style controls when supported. */
  deliveryNote?: string | null;
  previousText?: string | null;
  nextText?: string | null;
}

export interface SynthesizeResult {
  /** MP3 bytes. */
  audio: Buffer;
  mimeType: "audio/mpeg";
}

export interface TTSProvider {
  readonly name: string;
  listVoices(): Promise<Voice[]>;
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>;
}

export class TTSError extends Error {}
