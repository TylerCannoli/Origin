import { TTSError, type SynthesizeRequest, type SynthesizeResult, type TTSProvider, type Voice, type VoiceAge, type VoiceGender } from "@/lib/tts/types";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  preview_url?: string;
  description?: string;
}

function mapGender(v?: string): VoiceGender | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes("female")) return "female";
  if (s.includes("male")) return "male";
  if (s.includes("neutral") || s.includes("non")) return "neutral";
  return null;
}

function mapAge(v?: string): VoiceAge | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes("child")) return "child";
  if (s.includes("teen")) return "teen";
  if (s.includes("young")) return "young_adult";
  if (s.includes("middle")) return "middle_aged";
  if (s.includes("old") || s.includes("elder") || s.includes("senior")) return "elderly";
  if (s.includes("adult")) return "adult";
  return null;
}

/** Maps a short delivery note to ElevenLabs' numeric style exaggeration (0-1). */
export function styleFromDeliveryNote(note?: string | null): number {
  if (!note) return 0.15;
  const n = note.toLowerCase();
  if (/(shout|yell|scream|roar|furious|urgent|plead|sob|panick)/.test(n)) return 0.7;
  if (/(whisper|hush|soft|quiet|murmur|gentle|tender)/.test(n)) return 0.35;
  if (/(sarcas|dry|flat|deadpan|bored)/.test(n)) return 0.25;
  if (/(excited|laugh|cheer|bright|eager)/.test(n)) return 0.55;
  return 0.3;
}

/** ElevenLabs REST provider. Requires ELEVENLABS_API_KEY; models with audio-tag support get the note inline. */
export class ElevenLabsTTS implements TTSProvider {
  readonly name = "elevenlabs";
  private voicesCache: { at: number; voices: Voice[] } | null = null;
  constructor(
    private readonly apiKey: string,
    private readonly modelId = "eleven_multilingual_v2",
    private readonly baseUrl = "https://api.elevenlabs.io",
  ) {
    if (!apiKey) throw new TTSError("ELEVENLABS_API_KEY is not set");
  }

  async listVoices(): Promise<Voice[]> {
    if (this.voicesCache && Date.now() - this.voicesCache.at < 10 * 60 * 1000) return this.voicesCache.voices;
    const res = await fetch(`${this.baseUrl}/v1/voices`, { headers: { "xi-api-key": this.apiKey } });
    if (!res.ok) throw new TTSError(`ElevenLabs voices request failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { voices: ElevenLabsVoice[] };
    const voices: Voice[] = data.voices.map((v) => {
      const labels = v.labels ?? {};
      const descriptors = [labels.description, labels.descriptive, labels.use_case, v.description]
        .filter((x): x is string => !!x)
        .flatMap((x) => x.toLowerCase().split(/[,\s/]+/))
        .filter((w) => w.length > 2);
      return {
        id: v.voice_id,
        name: v.name,
        gender: mapGender(labels.gender),
        age: mapAge(labels.age),
        accent: labels.accent?.toLowerCase() ?? null,
        descriptors: [...new Set(descriptors)],
        previewUrl: v.preview_url ?? null,
      };
    });
    this.voicesCache = { at: Date.now(), voices };
    return voices;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const supportsTags = /v3/.test(this.modelId);
    const text = supportsTags && req.deliveryNote ? `[${req.deliveryNote}] ${req.text}` : req.text;
    const body = {
      text,
      model_id: this.modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: styleFromDeliveryNote(req.deliveryNote), use_speaker_boost: true },
      ...(req.previousText ? { previous_text: req.previousText.slice(-300) } : {}),
      ...(req.nextText ? { next_text: req.nextText.slice(0, 300) } : {}),
    };
    const res = await fetch(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new TTSError(`ElevenLabs synthesis failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mimeType: "audio/mpeg" };
  }
}
