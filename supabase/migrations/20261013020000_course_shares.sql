-- Partage d'un cours avec un autre compte, en lecture seule. La destinataire est désignée par
-- son adresse e-mail : le partage tient même si elle ne s'est encore jamais connectée.
create table course_shares (
  course_id uuid not null references courses on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  owner_email text not null,
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  created_at timestamptz not null default now(),
  primary key (course_id, recipient_email)
);

create index course_shares_recipient_idx on course_shares (recipient_email);
create index course_shares_owner_idx on course_shares (owner_id);

alter table course_shares enable row level security;

-- Ne référence pas `courses` : la politique de `courses` lit cette table, pas l'inverse.
create policy course_shares_select_mine on course_shares for select to authenticated
  using (owner_id = (select auth.uid())
         or recipient_email = lower((select auth.jwt() ->> 'email')));

-- Politiques ajoutées à côté des « own » : elles se cumulent (OU). Chunks, rendus et dépenses
-- restent réservés à la propriétaire.
create policy courses_select_shared on courses for select to authenticated
  using (exists (select 1 from course_shares s
                 where s.course_id = courses.id
                   and s.recipient_email = lower((select auth.jwt() ->> 'email'))));

create policy sections_select_shared on sections for select to authenticated
  using (exists (select 1 from course_shares s
                 where s.course_id = sections.course_id
                   and s.recipient_email = lower((select auth.jwt() ->> 'email'))));

create policy playback_progress_all_shared on playback_progress for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from course_shares s
                where s.course_id = playback_progress.course_id
                  and s.recipient_email = lower((select auth.jwt() ->> 'email')))
  );

-- Écritures par le serveur uniquement, comme le reste.
revoke all on course_shares from anon, authenticated;
grant select on course_shares to authenticated;
grant all on course_shares to service_role;
