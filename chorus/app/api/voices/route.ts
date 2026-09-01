import { handle, json } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { createTTS } from "@/lib/tts";

/** Voice library for the picker. */
export const GET = handle(async (req) => {
  await requireUser(req);
  const tts = createTTS();
  return json({ provider: tts.name, voices: await tts.listVoices() });
});
