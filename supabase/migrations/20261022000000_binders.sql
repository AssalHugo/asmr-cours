-- Classeurs : un gros PDF (polycopié de plusieurs cours) importé une seule fois, découpé en
-- leçons. Chaque leçon choisie devient un cours ordinaire, lancé l'une après l'autre (file
-- d'attente) ; un échantillon de quelques minutes se fait écouter avant de tout payer.

create type binder_status as enum ('draft', 'running', 'paused', 'done');

create table binders (
  -- Identifiant du dépôt : le PDF est sous `uploads/{user_id}/{id}/`.
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  source_key text not null,
  pages int not null check (pages > 0),
  -- Caractères lus sur chaque page, sans IA : estimation des leçons, pages vides en bordure.
  page_chars int[] not null,
  -- Texte non lisible sans IA (scan) : les tailles sont des estimations larges.
  scanned boolean not null default false,
  -- Comment les leçons ont été trouvées : sommaire, signets ou découpage régulier.
  detection text not null check (detection in ('toc', 'outline', 'pages')),
  status binder_status not null default 'draft',
  error text,
  -- Réglages communs aux leçons (voix, mode, ambiance, quiz, vitesse, qualité), fixés au lancement.
  settings jsonb,
  folder_id uuid references folders on delete set null,
  sample_course_id uuid references courses on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index binders_user_created_idx on binders (user_id, created_at desc);

create trigger binders_set_updated_at
  before update on binders
  for each row execute function set_updated_at();

create table binder_lessons (
  id uuid primary key default gen_random_uuid(),
  binder_id uuid not null references binders on delete cascade,
  idx int not null,
  title text not null check (char_length(title) between 1 and 200),
  first_page int not null check (first_page >= 1),
  last_page int not null,
  chars int not null default 0,
  selected boolean not null default true,
  -- idle : hors file · queued : en attente · launched : cours créé (`course_id`).
  state text not null default 'idle' check (state in ('idle', 'queued', 'launched')),
  -- Identifiant du futur cours : ses pages sont déposées sous `uploads/{user}/{planned_course_id}/`.
  planned_course_id uuid not null default gen_random_uuid(),
  source_key text,
  course_id uuid references courses on delete set null,
  unique (binder_id, idx),
  check (last_page >= first_page)
);

create index binder_lessons_binder_idx on binder_lessons (binder_id);
create index binder_lessons_course_idx on binder_lessons (course_id);

-- Échantillon d'un classeur : un cours court, caché de la bibliothèque.
alter table courses add column is_sample boolean not null default false;
grant select (is_sample) on courses to authenticated;

alter table binders enable row level security;
alter table binder_lessons enable row level security;

create policy binders_select_own on binders for select to authenticated
  using (user_id = (select auth.uid()));

create policy binder_lessons_select_own on binder_lessons for select to authenticated
  using (exists (select 1 from binders b
                 where b.id = binder_lessons.binder_id and b.user_id = (select auth.uid())));

-- Écritures par le serveur uniquement ; les clés de stockage restent invisibles au navigateur.
revoke all on binders, binder_lessons from anon, authenticated;
grant select (id, user_id, title, pages, page_chars, scanned, detection, status, error, settings,
              folder_id, sample_course_id, created_at, updated_at)
  on binders to authenticated;
grant select (id, binder_id, idx, title, first_page, last_page, chars, selected, state, course_id)
  on binder_lessons to authenticated;
grant all on binders, binder_lessons to service_role;

-- Remplace les leçons d'un classeur d'un seul tenant : une insertion refusée laisse les
-- anciennes en place. Exécutable par le serveur seulement.
create function replace_binder_lessons(p_binder_id uuid, p_lessons jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.binder_lessons where binder_id = p_binder_id;
  insert into public.binder_lessons (binder_id, idx, title, first_page, last_page, chars, selected,
                                     state, planned_course_id, source_key)
  select p_binder_id, l.idx, l.title, l.first_page, l.last_page, l.chars, l.selected,
         coalesce(l.state, 'idle'), coalesce(l.planned_course_id, gen_random_uuid()), l.source_key
  from jsonb_to_recordset(p_lessons) as l(idx int, title text, first_page int, last_page int,
                                          chars int, selected boolean, state text,
                                          planned_course_id uuid, source_key text);
end;
$$;

revoke execute on function replace_binder_lessons(uuid, jsonb) from public, anon, authenticated;
grant execute on function replace_binder_lessons(uuid, jsonb) to service_role;
