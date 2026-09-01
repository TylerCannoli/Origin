/**
 * Central, lazily-evaluated environment access. Nothing here throws at import time so the
 * Next.js build can run without secrets; consumers call the getters they need.
 */
function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export const env = {
  get databaseUrl() {
    return str("DATABASE_URL");
  },
  get redisUrl() {
    return str("REDIS_URL", "redis://localhost:6379");
  },
  get secret() {
    return str("CHORUS_SECRET", "dev-insecure-secret");
  },
  get appUrl() {
    return str("NEXT_PUBLIC_APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get supabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey) return null;
    return { url, anonKey, serviceRoleKey: serviceRoleKey ?? null, bucket: process.env.SUPABASE_STORAGE_BUCKET ?? "chorus" };
  },
  get devAuthEnabled() {
    return process.env.CHORUS_DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
  },
  get storageProvider(): "supabase" | "local" {
    const explicit = process.env.CHORUS_STORAGE;
    if (explicit === "supabase" || explicit === "local") return explicit;
    return this.supabase?.serviceRoleKey ? "supabase" : "local";
  },
  get localStorageDir() {
    return str("CHORUS_LOCAL_STORAGE_DIR", "./.data/storage");
  },
  get llmProvider(): "anthropic" | "fake" {
    return process.env.CHORUS_LLM_PROVIDER === "fake" ? "fake" : "anthropic";
  },
  get llmModelStrong() {
    return str("CHORUS_LLM_MODEL_STRONG", "claude-opus-5");
  },
  get llmModelFast() {
    // The spec asks for a fast/cheap model for high-volume per-paragraph attribution (§5.1);
    // Sonnet 5 is the cheaper current-generation tier. Override via env.
    return str("CHORUS_LLM_MODEL_FAST", "claude-sonnet-5");
  },
  get ttsProvider(): "elevenlabs" | "mock" {
    return process.env.CHORUS_TTS_PROVIDER === "elevenlabs" ? "elevenlabs" : "mock";
  },
  get elevenLabs() {
    return { apiKey: process.env.ELEVENLABS_API_KEY ?? "", modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2" };
  },
  get ffmpegPath() {
    return str("FFMPEG_PATH", "ffmpeg");
  },
  get ffprobePath() {
    return str("FFPROBE_PATH", "ffprobe");
  },
  get voiceCloningEnabled() {
    return process.env.CHORUS_ENABLE_VOICE_CLONING === "1";
  },
};
