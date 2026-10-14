-- Messages vocaux : enregistrés par un compte admin pour la propriétaire d'un cours, joués
-- une fois au lancement du cours (`at_ms` nul) ou à un instant précis de la lecture.

create table voice_messages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses on delete cascade,
  sender_id uuid references auth.users on delete set null,
  recipient_id uuid not null references auth.users on delete cascade,
  storage_key text not null,
  mime text not null,
  duration_ms int not null check (duration_ms > 0 and duration_ms <= 300000),
  at_ms int check (at_ms >= 0),
  played_at timestamptz,
  created_at timestamptz not null default now()
);

create index voice_messages_course_idx on voice_messages (course_id, recipient_id);

alter table voice_messages enable row level security;

-- La destinataire lit ses messages, sans la clé de stockage (servie par /api/messages).
-- Écritures et marquage « entendu » : serveur uniquement, avec la clé secrète.
revoke all on voice_messages from anon, authenticated;
grant select (id, course_id, recipient_id, duration_ms, at_ms, played_at, created_at)
  on voice_messages to authenticated;
grant all on voice_messages to service_role;

create policy voice_messages_select_recipient on voice_messages for select to authenticated
  using (recipient_id = (select auth.uid()));
