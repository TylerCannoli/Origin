import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sql } from "postgres";
import type { StorageProvider } from "@/lib/storage";
import { storageKeys } from "@/lib/storage";
import type { TTSProvider } from "@/lib/tts/types";
import type { FFmpeg } from "@/lib/audio/ffmpeg";
import type { ChapterRow, Pacing, ProjectRow } from "@/lib/db/types";

export interface AssemblyDeps {
  sql: Sql;
  storage: StorageProvider;
  tts: TTSProvider;
  ffmpeg: FFmpeg;
  onProgress?: (current: number, total: number, message?: string) => Promise<void> | void;
}

/** Inter-cue gaps in ms per pacing preset (§4.6 step 4). */
export const GAP_PRESETS: Record<Pacing, { exchange: number; shift: number; narration: number; chapterIntro: number }> = {
  tight: { exchange: 220, shift: 420, narration: 320, chapterIntro: 900 },
  normal: { exchange: 350, shift: 650, narration: 480, chapterIntro: 1200 },
  relaxed: { exchange: 520, shift: 900, narration: 700, chapterIntro: 1600 },
};

export function gapBetween(prevType: "narration" | "dialogue" | null, nextType: "narration" | "dialogue", pacing: Pacing): number {
  const g = GAP_PRESETS[pacing];
  if (!prevType) return 0;
  if (prevType === "dialogue" && nextType === "dialogue") return g.exchange;
  if (prevType === "narration" && nextType === "narration") return g.narration;
  return g.shift;
}

interface RenderCue {
  id: string;
  order_index: number;
  type: "narration" | "dialogue";
  text: string;
  delivery_note: string | null;
  character_id: string;
  character_voice: string | null;
  is_excluded: boolean;
  recording_id: string | null;
  recording_url: string | null;
  recording_mime: string | null;
}

export const textHash = (text: string, note: string | null) => createHash("sha256").update(`${text}\n${note ?? ""}`).digest("hex").slice(0, 32);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 1500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/**
 * Assembly & Mastering Agent, chapter scope (§4.6): human takes where present, cached TTS
 * otherwise; every clip mastered (gate/high-pass for humans, silence trim, loudnorm), joined
 * with pacing-dependent gaps into one chapter MP3. Idempotent unless force.
 */
export async function renderChapter(deps: AssemblyDeps, input: { project_id: string; chapter_id: string; force?: boolean }): Promise<{ rendered: boolean; audio_url?: string }> {
  const { sql, storage, tts, ffmpeg } = deps;
  const [project] = await sql<ProjectRow[]>`select * from projects where id = ${input.project_id}`;
  const [chapter] = await sql<ChapterRow[]>`select * from chapters where id = ${input.chapter_id} and project_id = ${input.project_id}`;
  if (!project || !chapter) throw new Error("Chapter not found");
  if (!input.force && chapter.status === "rendered") {
    const [existing] = await sql<{ audio_url: string }[]>`select audio_url from rendered_audio where chapter_id = ${chapter.id} and scope = 'chapter' order by rendered_at desc limit 1`;
    if (existing) return { rendered: false, audio_url: existing.audio_url };
  }

  const cues = await sql<RenderCue[]>`
    select cu.id, cu.order_index, cu.type, cu.text, cu.delivery_note, cu.character_id,
      c.ai_voice_id as character_voice, c.is_excluded,
      r.id as recording_id, r.audio_url as recording_url, r.mime_type as recording_mime
    from cues cu
    join characters c on c.id = cu.character_id
    left join lateral (
      select id, audio_url, mime_type from recordings rr where rr.cue_id = cu.id and rr.status <> 'rejected'
      order by (rr.status = 'approved') desc, rr.created_at desc limit 1
    ) r on true
    where cu.chapter_id = ${chapter.id} order by cu.order_index`;
  if (cues.length === 0) throw new Error("This chapter has no lines to render yet");

  const [narrator] = await sql<{ ai_voice_id: string | null }[]>`select ai_voice_id from characters where project_id = ${project.id} and is_narrator limit 1`;
  const catalog = await tts.listVoices();
  const fallbackVoice = narrator?.ai_voice_id ?? catalog[0]?.id;
  if (!fallbackVoice) throw new Error("No AI voice is available; configure the TTS provider");
  const voiceFor = (cue: RenderCue) => (cue.is_excluded ? fallbackVoice : (cue.character_voice ?? fallbackVoice));

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "chorus-render-"));
  try {
    const parts: string[] = [];
    const silenceCache = new Map<number, string>();
    const silence = async (ms: number) => {
      const key = Math.round(ms / 10) * 10;
      let f = silenceCache.get(key);
      if (!f) {
        f = path.join(work, `silence-${key}.wav`);
        await ffmpeg.run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", (key / 1000).toFixed(3), "-codec:a", "pcm_s16le", f]);
        silenceCache.set(key, f);
      }
      return f;
    };
    const pacing = project.pacing ?? "normal";

    // Chapter title read by the narrator voice, then a pause.
    if (chapter.title) {
      const titleKey = `projects/${project.id}/tts/title-${textHash(chapter.title, fallbackVoice)}.mp3`;
      const raw = path.join(work, "title.mp3");
      if (await storage.exists(titleKey)) await fs.writeFile(raw, await storage.get(titleKey));
      else {
        const { audio } = await withRetry(() => tts.synthesize({ text: chapter.title!, voiceId: fallbackVoice, deliveryNote: "calm, announcing" }));
        await fs.writeFile(raw, audio);
        await storage.put(titleKey, audio, "audio/mpeg");
      }
      const mastered = path.join(work, "title.wav");
      await ffmpeg.masterClip(raw, mastered, { human: false });
      parts.push(mastered, await silence(GAP_PRESETS[pacing].chapterIntro));
    }

    let prevType: "narration" | "dialogue" | null = null;
    for (const [i, cue] of cues.entries()) {
      await deps.onProgress?.(i, cues.length, `Rendering line ${i + 1} of ${cues.length}`);
      const raw = path.join(work, `cue-${i}.src`);
      let human = false;
      if (cue.recording_url) {
        await fs.writeFile(raw, await storage.get(cue.recording_url));
        human = true;
      } else {
        const voiceId = voiceFor(cue);
        const hash = textHash(cue.text, cue.delivery_note);
        const [cached] = await sql<{ audio_url: string }[]>`select audio_url from tts_cache where cue_id = ${cue.id} and voice_id = ${voiceId} and text_hash = ${hash}`;
        if (cached && (await storage.exists(cached.audio_url))) {
          await fs.writeFile(raw, await storage.get(cached.audio_url));
        } else {
          const prev = cues[i - 1]?.text ?? null;
          const next = cues[i + 1]?.text ?? null;
          const { audio } = await withRetry(() => tts.synthesize({ text: cue.text, voiceId, deliveryNote: cue.delivery_note, previousText: prev, nextText: next }));
          const key = storageKeys.ttsCache(project.id, `${cue.id}-${voiceId}-${hash}`.replace(/[^a-zA-Z0-9_-]/g, "_"));
          await storage.put(key, audio, "audio/mpeg");
          await sql`insert into tts_cache (project_id, cue_id, voice_id, text_hash, audio_url) values (${project.id}, ${cue.id}, ${voiceId}, ${hash}, ${key})
            on conflict (cue_id, voice_id, text_hash) do update set audio_url = excluded.audio_url`;
          await fs.writeFile(raw, audio);
        }
      }
      const mastered = path.join(work, `cue-${i}.wav`);
      try {
        await ffmpeg.masterClip(raw, mastered, { human });
      } catch (err) {
        if (!human) throw err;
        // A corrupt human upload should not sink the chapter: fall back to the AI voice for this line.
        console.warn(`[render] recording ${cue.recording_id} unreadable, using AI voice: ${err instanceof Error ? err.message : err}`);
        const voiceId = voiceFor(cue);
        const { audio } = await withRetry(() => tts.synthesize({ text: cue.text, voiceId, deliveryNote: cue.delivery_note }));
        await fs.writeFile(raw, audio);
        await ffmpeg.masterClip(raw, mastered, { human: false });
      }
      const gap = gapBetween(prevType, cue.type, pacing);
      if (gap > 0) parts.push(await silence(gap));
      parts.push(mastered);
      prevType = cue.type;
    }
    parts.push(await silence(GAP_PRESETS[pacing].chapterIntro));

    const out = path.join(work, "chapter.mp3");
    await ffmpeg.concatToMp3(parts, out, { metadata: { title: chapter.title ?? `Chapter ${chapter.order_index + 1}`, album: project.title, track: String(chapter.order_index + 1) } });
    const durationMs = await ffmpeg.probeDurationMs(out);
    const version = Date.now().toString(36);
    const key = storageKeys.chapterRender(project.id, chapter.id, version);
    await storage.put(key, await fs.readFile(out), "audio/mpeg");

    const old = await sql<{ audio_url: string }[]>`select audio_url from rendered_audio where chapter_id = ${chapter.id} and scope = 'chapter'`;
    await sql.begin(async (tx) => {
      await tx`delete from rendered_audio where chapter_id = ${chapter.id} and scope = 'chapter'`;
      await tx`insert into rendered_audio (chapter_id, project_id, scope, audio_url, format, duration_ms) values (${chapter.id}, ${project.id}, 'chapter', ${key}, 'mp3', ${durationMs})`;
      await tx`update chapters set status = 'rendered' where id = ${chapter.id}`;
      // Any full-book render is now stale.
      await tx`delete from rendered_audio where project_id = ${project.id} and scope = 'full_book'`;
    });
    for (const o of old) await storage.delete(o.audio_url).catch(() => {});
    return { rendered: true, audio_url: key };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/**
 * Assembly, book scope (§4.6 step 6): joins the rendered chapters into a full MP3 and an
 * .m4b with chapter markers. Requires every chapter to be rendered.
 */
export async function renderBook(deps: AssemblyDeps, input: { project_id: string; force?: boolean }): Promise<{ mp3: string; m4b: string; chapters: number }> {
  const { sql, storage, ffmpeg } = deps;
  const [project] = await sql<ProjectRow[]>`select * from projects where id = ${input.project_id}`;
  if (!project) throw new Error("Project not found");
  const chapters = await sql<(ChapterRow & { audio_url: string | null; duration_ms: number | null })[]>`
    select ch.*, ra.audio_url, ra.duration_ms from chapters ch
    left join lateral (select audio_url, duration_ms from rendered_audio r where r.chapter_id = ch.id and r.scope = 'chapter' order by rendered_at desc limit 1) ra on true
    where ch.project_id = ${project.id} order by ch.order_index`;
  const missing = chapters.filter((c) => c.status !== "rendered" || !c.audio_url);
  if (missing.length > 0) throw new Error(`${missing.length} chapter(s) are not rendered yet: ${missing.map((m) => m.title ?? m.order_index + 1).join(", ")}`);

  if (!input.force) {
    const existing = await sql<{ format: string; audio_url: string }[]>`select format, audio_url from rendered_audio where project_id = ${project.id} and scope = 'full_book'`;
    const mp3 = existing.find((e) => e.format === "mp3");
    const m4b = existing.find((e) => e.format === "m4b");
    if (mp3 && m4b) return { mp3: mp3.audio_url, m4b: m4b.audio_url, chapters: chapters.length };
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "chorus-book-"));
  try {
    const parts: { file: string; title: string; durationMs: number }[] = [];
    for (const [i, ch] of chapters.entries()) {
      await deps.onProgress?.(i, chapters.length, `Joining chapter ${i + 1} of ${chapters.length}`);
      const file = path.join(work, `ch-${i}.mp3`);
      await fs.writeFile(file, await storage.get(ch.audio_url!));
      parts.push({ file, title: ch.title ?? `Chapter ${i + 1}`, durationMs: ch.duration_ms ?? (await ffmpeg.probeDurationMs(file)) });
    }
    const markers: { title: string; start_ms: number }[] = [];
    let t = 0;
    for (const p of parts) {
      markers.push({ title: p.title, start_ms: t });
      t += p.durationMs;
    }
    const mp3Out = path.join(work, "book.mp3");
    await ffmpeg.concatToMp3(
      parts.map((p) => p.file),
      mp3Out,
      { metadata: { title: project.title, album: project.title, genre: "Audiobook" } },
    );
    const m4bOut = path.join(work, "book.m4b");
    await ffmpeg.concatToM4b(parts, m4bOut, { title: project.title });
    const version = Date.now().toString(36);
    const mp3Key = storageKeys.bookRender(project.id, version, "mp3");
    const m4bKey = storageKeys.bookRender(project.id, version, "m4b");
    await storage.put(mp3Key, await fs.readFile(mp3Out), "audio/mpeg");
    await storage.put(m4bKey, await fs.readFile(m4bOut), "audio/mp4");
    const durationMs = await ffmpeg.probeDurationMs(mp3Out);

    const old = await sql<{ audio_url: string }[]>`select audio_url from rendered_audio where project_id = ${project.id} and scope = 'full_book'`;
    await sql.begin(async (tx) => {
      await tx`delete from rendered_audio where project_id = ${project.id} and scope = 'full_book'`;
      await tx`insert into rendered_audio (project_id, scope, audio_url, format, duration_ms, chapter_markers) values
        (${project.id}, 'full_book', ${mp3Key}, 'mp3', ${durationMs}, ${tx.json(markers as never)}),
        (${project.id}, 'full_book', ${m4bKey}, 'm4b', ${durationMs}, ${tx.json(markers as never)})`;
      await tx`update projects set updated_at = now() where id = ${project.id}`;
    });
    for (const o of old) await storage.delete(o.audio_url).catch(() => {});
    return { mp3: mp3Key, m4b: m4bKey, chapters: chapters.length };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
