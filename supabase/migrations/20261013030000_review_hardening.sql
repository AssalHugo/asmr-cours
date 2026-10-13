-- Durcissement après revue : agrégats de dépense, limites atomiques, plafond de budget,
-- unicité des voix, colonnes internes des cours cachées au navigateur.

-- ---------------------------------------------------------------------------
-- Dépenses : agrégées en SQL. Additionner les lignes côté client les tronquerait
-- à `max_rows` (1 000), alors qu'un cours écrit une ligne par chunk TTS.
-- ---------------------------------------------------------------------------
-- Dépense depuis une date : d'une utilisatrice, ou de tous les comptes si `p_user_id` est nul.
create function spend_since(p_since timestamptz, p_user_id uuid default null) returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.usage_events
  where created_at >= p_since
    and (p_user_id is null or user_id = p_user_id);
$$;

create function course_cost(p_course_id uuid) returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.usage_events
  where course_id = p_course_id;
$$;

revoke execute on function spend_since(timestamptz, uuid) from public, anon, authenticated;
revoke execute on function course_cost(uuid) from public, anon, authenticated;
grant execute on function spend_since(timestamptz, uuid) to service_role;
grant execute on function course_cost(uuid) to service_role;

-- Coût réel par cours, pour l'historique des réglages (RLS de `usage_events` appliquée).
create view course_costs
with (security_invoker = true) as
  select course_id, sum(cost_usd)::numeric(12,5) as cost_usd
  from usage_events
  where course_id is not null
  group by course_id;

revoke all on course_costs from anon, authenticated;
grant select on course_costs to authenticated;
grant all on course_costs to service_role;

-- ---------------------------------------------------------------------------
-- Limite quotidienne : journal des lancements, qui survit à la suppression d'un cours.
-- ---------------------------------------------------------------------------
create table course_launches (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index course_launches_user_created_idx on course_launches (user_id, created_at desc);
alter table course_launches enable row level security;
revoke all on course_launches from anon, authenticated;
grant all on course_launches to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into course_launches (user_id, created_at) select user_id, created_at from courses;

-- ---------------------------------------------------------------------------
-- Un seul cours en préparation par compte, garanti par la base : deux requêtes
-- simultanées ne peuvent plus passer toutes les deux le contrôle applicatif.
-- ---------------------------------------------------------------------------
update courses c
set status = 'failed',
    error = 'Un autre cours était déjà en préparation. Tu peux reprendre celui-ci.'
where c.status not in ('ready', 'failed')
  and exists (
    select 1 from courses n
    where n.user_id = c.user_id
      and n.status not in ('ready', 'failed')
      and (n.created_at, n.id) > (c.created_at, c.id)
  );

create unique index courses_one_active_per_user on courses (user_id)
  where status not in ('ready', 'failed');

-- ---------------------------------------------------------------------------
-- Budget : la RLS laisse chacune régler le sien, la base en borne le montant.
-- ---------------------------------------------------------------------------
alter table profiles
  add constraint profiles_budget_cap check (monthly_budget_usd <= 500);

-- ---------------------------------------------------------------------------
-- Voix : une même voix Gemini n'apparaît qu'une fois par compte et par environnement
-- (le semis des voix de départ pouvait se doubler sur deux requêtes simultanées).
-- ---------------------------------------------------------------------------
delete from voices v
using voices k
where k.user_id = v.user_id
  and k.env = v.env
  and k.provider_voice_id = v.provider_voice_id
  and (k.created_at, k.id) < (v.created_at, v.id);

create unique index voices_user_env_provider_idx on voices (user_id, env, provider_voice_id);

-- ---------------------------------------------------------------------------
-- Cours : les colonnes internes (clés de stockage, identifiants de run et de batch) ne sont
-- plus lisibles depuis le navigateur, ni par la propriétaire ni par une destinataire de
-- partage. Le serveur les lit avec la clé secrète.
-- ---------------------------------------------------------------------------
revoke select on courses from authenticated;
grant select (id, user_id, title, source_kind, source_chars, mode, tier, quality, voice_id,
              ambience, ambience_gain_db, address_form, status, progress, error, est_cost_usd,
              actual_cost_usd, duration_ms, created_at, updated_at)
  on courses to authenticated;
