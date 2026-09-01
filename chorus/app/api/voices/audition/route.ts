import { createHash } from "node:crypto";
import { badRequest, handle, json, readJson } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/server";
import { rateLimit } from "@/lib/api/rate-limit";
import { auditionSchema } from "@/lib/validation/schemas";
import { createTTS } from "@/lib/tts";
import { storage, storageKeys } from "@/lib/storage";

const DEFAULT_LINE = "The storm came in off the water an hour before dusk, and every lamp in the lighthouse was already lit.";

/**
 * Synthesises a short preview for a voice (§4.5 audition). Cached in storage by (voice, text,
 * note) so repeated auditions are free. The web app calls the TTS provider directly here
 * because previews are short and interactive (§5.2).
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await rateLimit(`audition:${user.id}`, 60, 3600);
  const body = await readJson(req, (d) => auditionSchema.parse(d));
  const tts = createTTS();
  const voices = await tts.listVoices();
  const voice = voices.find((v) => v.id === body.voice_id);
  if (!voice) throw badRequest("That voice is not in the voice library");
  const text = body.text?.trim() || DEFAULT_LINE;
  const hash = createHash("sha256").update(`${tts.name}|${voice.id}|${text}|${body.delivery_note ?? ""}`).digest("hex").slice(0, 24);
  const key = storageKeys.audition(voice.id, hash);
  const store = storage();
  if (!(await store.exists(key))) {
    const { audio } = await tts.synthesize({ text, voiceId: voice.id, deliveryNote: body.delivery_note ?? null });
    await store.put(key, audio, "audio/mpeg");
  }
  return json({ url: await store.signedUrl(key, 3600), voice });
});
