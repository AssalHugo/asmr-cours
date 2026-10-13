-- Murmure — schéma initial (docs/SPEC.md §6)

create type course_status as enum ('queued','extracting','rewriting','verifying','synthesizing',
  'waiting_batch','assembling','mastering','ready','failed');
create type voice_mode as enum ('whisper','soft');
create type tts_tier as enum ('eco','express');
create type tts_quality as enum ('standard','economy');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  default_voice_id uuid,
  default_mode voice_mode not null default 'whisper',
  default_ambience text not null default 'rain',
  default_tier tts_tier not null default 'eco',
  default_quality tts_quality not null default 'standard',
  address_form text not null default 'tu' check (address_form in ('tu','vous')),
  monthly_budget_usd numeric(8,2) not null default 10 check (monthly_budget_usd >= 0),
  created_at timestamptz not null default now()
);

create table voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  env text not null check (env in ('dev','prod')),
  provider text not null default 'gemini',
  provider_voice_id text not null,
  kind text not null check (kind in ('prebuilt','designed','replicated')),
  label text not null,
  description text,
  sample_key text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_default_voice_fk
  foreign key (default_voice_id) references voices on delete set null;

create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  source_kind text not null check (source_kind in ('pdf','images','text')),
  source_keys text[] not null default '{}',
  source_chars int,
  mode voice_mode not null,
  tier tts_tier not null,
  quality tts_quality not null,
  voice_id uuid references voices on delete set null,
  ambience text not null,
  ambience_gain_db numeric(4,1) not null default 0,
  address_form text not null default 'tu' check (address_form in ('tu','vous')),
  status course_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  error text,
  trigger_run_id text,
  batch_job_id text,
  est_cost_usd numeric(8,4),
  actual_cost_usd numeric(8,4) not null default 0,
  duration_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  idx int not null,
  title text not null,
  source_text text not null,
  key_terms jsonb not null default '[]',
  key_facts jsonb not null default '[]',
  script jsonb,
  verified boolean not null default false,
  verify_report jsonb,
  start_ms int,
  duration_ms int,
  unique (course_id, idx)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  section_id uuid not null references sections on delete cascade,
  idx int not null,
  text text not null,
  caption text not null,
  style text not null,
  pause_after_ms int not null default 0,
  hash text not null,
  audio_key text,
  start_ms int,
  duration_ms int,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  unique (course_id, idx)
);

create table renders (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  kind text not null check (kind in ('voice','mix')),
  ambience text,
  key text not null,
  duration_ms int not null,
  bytes bigint,
  created_at timestamptz not null default now()
);

create table usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid references courses on delete set null,
  step text not null,
  model text not null,
  tier text not null check (tier in ('standard','batch')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  audio_seconds numeric(10,2) not null default 0,
  cost_usd numeric(10,5) not null,
  created_at timestamptz not null default now()
);

create table playback_progress (
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  position_ms int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index courses_user_created_idx on courses (user_id, created_at desc);
create index voices_user_env_idx on voices (user_id, env);
create index sections_course_idx on sections (course_id);
create index chunks_course_idx on chunks (course_id);
create index chunks_section_idx on chunks (section_id);
create index renders_course_idx on renders (course_id);
create index usage_events_user_created_idx on usage_events (user_id, created_at desc);
create index usage_events_course_idx on usage_events (course_id);

-- updated_at sur courses
create function set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger courses_set_updated_at
  before update on courses
  for each row execute function set_updated_at();

-- profil créé à l'inscription
create function handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- dépense du mois courant (estimation ; la console de facturation fait foi)
create view monthly_spend
with (security_invoker = true) as
  select user_id,
         date_trunc('month', now()) as month,
         coalesce(sum(cost_usd), 0)::numeric(10,5) as spent_usd
  from usage_events
  where created_at >= date_trunc('month', now())
  group by user_id;

-- ---------------------------------------------------------------------------
-- RLS : lecture de ses propres lignes. Les écritures métier passent par le
-- serveur (clé secrète, toujours filtrées par user_id), pour que budget et
-- limites ne soient pas contournables depuis le navigateur.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table voices enable row level security;
alter table courses enable row level security;
alter table sections enable row level security;
alter table chunks enable row level security;
alter table renders enable row level security;
alter table usage_events enable row level security;
alter table playback_progress enable row level security;

create policy profiles_select_own on profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy voices_select_own on voices for select to authenticated
  using (user_id = (select auth.uid()));

create policy courses_select_own on courses for select to authenticated
  using (user_id = (select auth.uid()));

create policy sections_select_own on sections for select to authenticated
  using (exists (select 1 from courses c
                 where c.id = sections.course_id and c.user_id = (select auth.uid())));

create policy chunks_select_own on chunks for select to authenticated
  using (exists (select 1 from courses c
                 where c.id = chunks.course_id and c.user_id = (select auth.uid())));

create policy renders_select_own on renders for select to authenticated
  using (exists (select 1 from courses c
                 where c.id = renders.course_id and c.user_id = (select auth.uid())));

create policy usage_events_select_own on usage_events for select to authenticated
  using (user_id = (select auth.uid()));

create policy playback_progress_all_own on playback_progress for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from courses c
                where c.id = playback_progress.course_id and c.user_id = (select auth.uid()))
  );

-- Privilèges explicites (ne dépend pas des défauts du projet)
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on profiles, voices, courses, sections, chunks, renders, usage_events, monthly_spend
  to authenticated;
grant update (display_name, default_voice_id, default_mode, default_ambience, default_tier,
              default_quality, address_form, monthly_budget_usd) on profiles to authenticated;
grant select, insert, update, delete on playback_progress to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
