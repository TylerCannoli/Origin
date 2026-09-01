# Chorus

AI-assisted audiobook casting. Upload a manuscript, get every character and line identified, hand parts to
friends to record from their browser, and stitch the takes (plus AI voices for anything unrecorded) into a
finished audiobook.

This directory is a self-contained Next.js 15 app plus a separate worker process. The rest of the
repository (the Python/Streamlit PACE project) is unrelated.

## What is here

| Area | Where |
|---|---|
| Web app (App Router pages + `/api` route handlers) | `app/`, `components/`, `lib/` |
| Worker process (BullMQ jobs: agents, TTS, ffmpeg) | `worker/` |
| Agent pipeline | `worker/agents/{ingestion,characterExtraction,dialogueAttribution,scriptSegmentation,voiceCasting,assembly}.ts` |
| Providers | `lib/llm` (Anthropic + offline fake), `lib/tts` (ElevenLabs + offline mock), `lib/storage` (Supabase + local), `lib/audio/ffmpeg.ts` |
| Schema (Supabase-compatible SQL with RLS) | `supabase/migrations/` |
| Tests | `tests/unit`, `tests/integration` (real Postgres, offline providers) |

## Running locally

Requirements: Node 22, PostgreSQL, Redis, `ffmpeg`/`ffprobe` on PATH.

```bash
cp .env.example .env.local        # web (Next.js reads .env.local)
cp .env.example .env              # worker (dotenv)
# edit DATABASE_URL / REDIS_URL if needed
npm install
npm run migrate                   # applies supabase/migrations/*.sql
npm run dev                       # web on :3000
npm run worker:dev                # in a second terminal
```

With the defaults in `.env.example` you get a fully offline setup:

- `CHORUS_DEV_AUTH=1` and no Supabase keys: sign in with any email on `/login` (never enabled in production).
- `CHORUS_STORAGE=local`: files live in `./.data/storage` and are served through signed `/api/storage/...` URLs.
- `CHORUS_LLM_PROVIDER=fake`: the pipeline runs on deterministic heuristics instead of calling Claude.
- `CHORUS_TTS_PROVIDER=mock`: "voices" are tone bursts rendered by ffmpeg, so renders complete without an API key.

To run the real thing set `ANTHROPIC_API_KEY` + `CHORUS_LLM_PROVIDER=anthropic` and `ELEVENLABS_API_KEY` +
`CHORUS_TTS_PROVIDER=elevenlabs` in the worker's `.env` (the web app only needs the TTS key for voice auditions).

### Supabase

1. Create a project, then run `npm run migrate` against its Postgres URL (the migrations create the `auth.uid()`
   shim only when the function is missing, so they are safe on Supabase).
2. Create a **private** storage bucket named `chorus` (or set `SUPABASE_STORAGE_BUCKET`).
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CHORUS_STORAGE=supabase`.
   Email/password and magic-link sign-in work out of the box; add OAuth providers in the Supabase dashboard.

## Tests

```bash
createdb chorus_test   # or any Postgres DB; see .env.test
npm test
```

Integration tests hit a real database and run ffmpeg; no network or API keys are needed.

## How the pipeline works

Each stage is a BullMQ job that persists its output, then enqueues the next stage (`lib/queue`, `worker/queues`):

1. **ingest** – parse txt/docx/epub/pdf, clean, detect chapters (heuristics first, LLM only for long manuscripts with no headings) → `manuscripts.raw_structure`, `chapters`.
2. **extract_characters** – chunked extraction + a reconciliation pass biased toward under-merging → `characters`, `manuscripts.extraction`.
3. **attribute_dialogue** – deterministic quote splitting; only dialogue spans go to the (cheaper) model in small batches with context; low-confidence lines are flagged `needs_review` → `manuscripts.attribution`.
4. **segment_script** – cue list per chapter with delivery notes (from adjacent narration; LLM only when no explicit cue) → `cues`.
5. **cast_voices** – rules-based match against the TTS voice catalog → `characters.ai_voice_id`.
6. **render_chapter / render_book** – human take if present (approved preferred, rejected never), otherwise cached TTS keyed by `(cue, voice, text hash)`; two-pass ffmpeg mastering, pacing gaps, chapter MP3s, then a full MP3 and an `.m4b` with chapter markers. A re-recorded line re-renders only its chapter.

Every model call is logged to `agent_runs`; the per-project breakdown is on the **Costs** page.

## Deviations from the spec (and why)

- **Next.js 15 / Tailwind 4** instead of Next 14: current stable releases; the App Router structure is unchanged.
- **Casting links are `/record/<token>`** rather than `/record/<project>/<character>?token=`: the token is unique and already scoped to a project and (optionally) a character, so the shorter form leaks nothing and is easier to share.
- **Extra columns/tables**: `characters.is_excluded`, `characters.merged_into_id`, `characters.voice_rationale`, `projects.pacing`, `projects.source_kind`, `cues.paragraph_id`, `manuscripts.extraction/attribution`, `pipeline_runs.progress`, `rendered_audio.format/duration_ms/chapter_markers`, and the `tts_cache` and `analytics_events` tables. All base columns from the spec are present with the specified shapes.
- **Recordings are used unless rejected**: assembly prefers approved takes but falls back to the newest submitted take, so an owner does not have to approve every line before generating.
- **Non-speaking characters are not cast**: they need no voice; their mentions are still used to merge full names with speaking nicknames.
- **Voice cloning (Phase 7)** is not implemented; `CHORUS_ENABLE_VOICE_CLONING` is reserved and off.
- **Model tiers**: the strong tier defaults to `claude-opus-5`; the high-volume attribution tier defaults to `claude-sonnet-5` per the spec's cost note. Both are env-configurable.
