-- Dossiers de la bibliothèque. Un dossier appartient à un compte ; le rangement d'un cours est
-- propre à chaque compte, pour qu'une destinataire de partage classe aussi les cours reçus sans
-- toucher au classement de la propriétaire.
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  -- Cible de la clé étrangère composite de `course_folders`.
  unique (id, user_id)
);

-- Un nom par compte, sans tenir compte de la casse.
create unique index folders_user_name_idx on folders (user_id, lower(name));

-- Un cours est dans un dossier au plus par compte. La clé composite garantit que le dossier
-- est bien celui du compte qui range.
create table course_folders (
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id),
  foreign key (folder_id, user_id) references folders (id, user_id) on delete cascade
);

create index course_folders_folder_idx on course_folders (folder_id);
create index course_folders_course_idx on course_folders (course_id);

alter table folders enable row level security;
alter table course_folders enable row level security;

create policy folders_select_own on folders for select to authenticated
  using (user_id = (select auth.uid()));

create policy course_folders_select_own on course_folders for select to authenticated
  using (user_id = (select auth.uid()));

-- Écritures par le serveur uniquement, comme le reste.
revoke all on folders, course_folders from anon, authenticated;
grant select on folders, course_folders to authenticated;
grant all on folders, course_folders to service_role;
