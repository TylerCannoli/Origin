-- Lightweight product analytics (Phase 6). Events are owner-scoped like everything else.
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  event text not null,
  props jsonb,
  created_at timestamptz default now()
);
create index if not exists analytics_events_project_idx on analytics_events(project_id, created_at desc);
create index if not exists analytics_events_event_idx on analytics_events(event, created_at desc);
alter table analytics_events enable row level security;
drop policy if exists analytics_owner on analytics_events;
create policy analytics_owner on analytics_events for select using (chorus_is_project_owner(project_id));
