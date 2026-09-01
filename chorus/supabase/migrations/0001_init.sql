-- Chorus initial schema. Written to run on Supabase (Postgres + auth schema) and on
-- a plain local Postgres (an auth.uid() shim is created when missing so RLS policies compile).

create extension if not exists pgcrypto;

-- auth.uid() shim for non-Supabase Postgres. On Supabase the function already exists
-- and this block is a no-op.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
      language sql stable
      as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  end if;
end $$;

-- Users (mirrors Supabase auth.users; app-level profile)
create table if not exists users (
  id uuid primary key,
  email text unique,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) not null,
  title text not null,
  visibility text not null default 'private', -- 'private' | 'invite_only' | 'public_listen'
  rights_attested boolean not null default false,
  source_file_url text,
  status text not null default 'draft', -- draft|processing|ready|error
  -- Extensions beyond the base spec (documented in README):
  pacing text not null default 'normal', -- tight|normal|relaxed (assembly gap presets)
  source_kind text,                       -- txt|docx|epub|pdf|paste
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists projects_owner_idx on projects(owner_id);

create table if not exists manuscripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  raw_structure jsonb not null,            -- output of Ingestion Agent (§4.1)
  extraction jsonb,                        -- persisted output of Character Extraction Agent (§4.2)
  attribution jsonb,                       -- persisted output of Dialogue Attribution Agent (§4.3)
  word_count int,
  created_at timestamptz default now()
);
create unique index if not exists manuscripts_project_idx on manuscripts(project_id);

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  order_index int not null,
  title text,
  source_chapter_id text,                  -- id inside manuscripts.raw_structure (e.g. ch_001)
  status text not null default 'pending'   -- pending|attributed|segmented|rendered
);
create index if not exists chapters_project_idx on chapters(project_id, order_index);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  canonical_name text not null,
  aliases text[] default '{}',
  blurb text,
  inferred_age_range text,
  inferred_gender_presentation text,
  ai_voice_id text,                        -- provider voice ID for fallback/preview
  is_narrator boolean default false,
  claimed_by_user_id uuid references users(id),
  -- Extensions:
  is_excluded boolean not null default false,  -- excluded minor characters fall back to narrator
  merged_into_id uuid references characters(id),
  voice_rationale text,
  confidence float,
  created_at timestamptz default now()
);
create index if not exists characters_project_idx on characters(project_id);

create table if not exists cues (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade not null,
  character_id uuid references characters(id) not null,
  order_index int not null,
  type text not null,                      -- 'narration' | 'dialogue'
  text text not null,
  delivery_note text,
  confidence float,
  needs_review boolean default false,
  paragraph_id text                        -- source paragraph in raw_structure
);
create index if not exists cues_chapter_idx on cues(chapter_id, order_index);
create index if not exists cues_character_idx on cues(character_id);

create table if not exists recordings (
  id uuid primary key default gen_random_uuid(),
  cue_id uuid references cues(id) on delete cascade not null,
  recorded_by_user_id uuid references users(id),
  guest_session_token text,
  audio_url text not null,                 -- storage key
  duration_ms int,
  mime_type text,
  status text not null default 'submitted', -- submitted|approved|rejected
  created_at timestamptz default now()
);
create index if not exists recordings_cue_idx on recordings(cue_id, created_at desc);

create table if not exists rendered_audio (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  scope text not null,                     -- 'chapter' | 'full_book'
  audio_url text not null,                 -- storage key
  format text not null default 'mp3',      -- mp3 | m4b
  duration_ms int,
  chapter_markers jsonb,                   -- [{title, start_ms}] for full_book renders
  rendered_at timestamptz default now()
);
create index if not exists rendered_audio_project_idx on rendered_audio(project_id, scope);

create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  stage text not null,
  status text not null,                    -- queued|running|complete|failed
  error text,
  progress jsonb,                          -- {current, total, message}
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists pipeline_runs_project_idx on pipeline_runs(project_id, created_at desc);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  agent_name text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  estimated_cost_usd numeric,
  input_hash text,
  status text not null default 'ok',       -- ok|error
  error text,
  created_at timestamptz default now()
);
create index if not exists agent_runs_project_idx on agent_runs(project_id, created_at desc);

create table if not exists casting_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  character_id uuid references characters(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists casting_invites_project_idx on casting_invites(project_id);

-- TTS render cache keyed by (cue_id, voice_id, text_hash) per §4.6.
create table if not exists tts_cache (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  cue_id uuid references cues(id) on delete cascade,
  voice_id text not null,
  text_hash text not null,
  audio_url text not null,
  duration_ms int,
  created_at timestamptz default now(),
  unique (cue_id, voice_id, text_hash)
);

-- ---------------------------------------------------------------------------
-- Row-Level Security. The web/worker processes connect with a service role and
-- enforce authorization in code; these policies protect direct Supabase client
-- access (anon/authenticated roles) as defense in depth.
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table projects enable row level security;
alter table manuscripts enable row level security;
alter table chapters enable row level security;
alter table characters enable row level security;
alter table cues enable row level security;
alter table recordings enable row level security;
alter table rendered_audio enable row level security;
alter table pipeline_runs enable row level security;
alter table agent_runs enable row level security;
alter table casting_invites enable row level security;
alter table tts_cache enable row level security;

create or replace function chorus_is_project_owner(p_project uuid) returns boolean
  language sql stable security definer as $$
  select exists (select 1 from projects p where p.id = p_project and p.owner_id = auth.uid());
$$;

create or replace function chorus_can_read_project(p_project uuid) returns boolean
  language sql stable security definer as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and (p.owner_id = auth.uid()
           or p.visibility = 'public_listen'
           or exists (select 1 from characters c where c.project_id = p.id and c.claimed_by_user_id = auth.uid()))
  );
$$;

drop policy if exists users_self on users;
create policy users_self on users for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists projects_owner_all on projects;
create policy projects_owner_all on projects for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists projects_read on projects;
create policy projects_read on projects for select using (chorus_can_read_project(id));

drop policy if exists manuscripts_owner on manuscripts;
create policy manuscripts_owner on manuscripts for all using (chorus_is_project_owner(project_id));

drop policy if exists chapters_read on chapters;
create policy chapters_read on chapters for select using (chorus_can_read_project(project_id));
drop policy if exists chapters_owner on chapters;
create policy chapters_owner on chapters for all using (chorus_is_project_owner(project_id));

drop policy if exists characters_read on characters;
create policy characters_read on characters for select using (chorus_can_read_project(project_id));
drop policy if exists characters_owner on characters;
create policy characters_owner on characters for all using (chorus_is_project_owner(project_id));

drop policy if exists cues_read on cues;
create policy cues_read on cues for select using (
  exists (select 1 from chapters ch where ch.id = chapter_id and chorus_can_read_project(ch.project_id))
);
drop policy if exists cues_owner on cues;
create policy cues_owner on cues for all using (
  exists (select 1 from chapters ch where ch.id = chapter_id and chorus_is_project_owner(ch.project_id))
);

drop policy if exists recordings_owner on recordings;
create policy recordings_owner on recordings for all using (
  recorded_by_user_id = auth.uid() or exists (
    select 1 from cues cu join chapters ch on ch.id = cu.chapter_id
    where cu.id = cue_id and chorus_is_project_owner(ch.project_id)
  )
);

drop policy if exists rendered_read on rendered_audio;
create policy rendered_read on rendered_audio for select using (chorus_can_read_project(project_id));
drop policy if exists rendered_owner on rendered_audio;
create policy rendered_owner on rendered_audio for all using (chorus_is_project_owner(project_id));

drop policy if exists pipeline_owner on pipeline_runs;
create policy pipeline_owner on pipeline_runs for all using (chorus_is_project_owner(project_id));
drop policy if exists agent_runs_owner on agent_runs;
create policy agent_runs_owner on agent_runs for select using (chorus_is_project_owner(project_id));
drop policy if exists invites_owner on casting_invites;
create policy invites_owner on casting_invites for all using (chorus_is_project_owner(project_id));
drop policy if exists tts_cache_owner on tts_cache;
create policy tts_cache_owner on tts_cache for all using (chorus_is_project_owner(project_id));
