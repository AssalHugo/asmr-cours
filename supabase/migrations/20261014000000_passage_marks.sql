-- « Je n'ai pas compris ce passage » : endroits marqués depuis le lecteur, à réexpliquer
-- depuis la page du cours. La légende est celle de captions.json au moment de la marque :
-- elle retrouve le passage (chunk) tant que le script n'a pas changé.
create table passage_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  course_id uuid not null references courses on delete cascade,
  position_ms int not null check (position_ms >= 0),
  caption text not null check (char_length(caption) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index passage_marks_course_user_idx on passage_marks (course_id, user_id);

-- Lecture de ses propres marques ; écritures par le serveur (clé secrète, filtrées par user_id).
alter table passage_marks enable row level security;
create policy passage_marks_select_own on passage_marks for select to authenticated
  using (user_id = (select auth.uid()));

grant select on passage_marks to authenticated;
grant all on passage_marks to service_role;
