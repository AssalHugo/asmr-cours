-- Mode admin : agrégats de dépense tous comptes confondus, lus avec la clé secrète.
-- Toujours calculés en SQL (une ligne par chunk TTS dépasserait vite `max_rows`).

-- Dépense par mois, des `p_months` derniers mois (mois en cours compris).
create function admin_spend_by_month(p_months int default 12)
returns table (month date, cost_usd numeric, events bigint)
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', created_at)::date as month,
         sum(cost_usd)::numeric(12,5) as cost_usd,
         count(*) as events
  from public.usage_events
  where created_at >= date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1)
  group by 1
  order by 1;
$$;

-- Dépense par compte depuis une date, avec le nombre de cours facturés.
create function admin_spend_by_user(p_since timestamptz)
returns table (user_id uuid, cost_usd numeric, courses bigint)
language sql
stable
set search_path = ''
as $$
  select user_id,
         sum(cost_usd)::numeric(12,5) as cost_usd,
         count(distinct course_id) as courses
  from public.usage_events
  where created_at >= p_since
  group by user_id;
$$;

-- Détail par étape et par modèle : depuis une date, ou pour un seul cours.
create function admin_spend_breakdown(p_since timestamptz default null, p_course_id uuid default null)
returns table (
  step text,
  model text,
  tier text,
  cost_usd numeric,
  events bigint,
  input_tokens bigint,
  output_tokens bigint,
  thinking_tokens bigint,
  audio_seconds numeric
)
language sql
stable
set search_path = ''
as $$
  select step,
         model,
         tier,
         sum(cost_usd)::numeric(12,5),
         count(*),
         sum(input_tokens)::bigint,
         sum(output_tokens)::bigint,
         sum(thinking_tokens)::bigint,
         sum(audio_seconds)::numeric(14,2)
  from public.usage_events
  where (p_since is null or created_at >= p_since)
    and (p_course_id is null or course_id = p_course_id)
  group by step, model, tier
  order by 4 desc;
$$;

-- Nombre de cours par compte et par état.
create function admin_course_counts()
returns table (user_id uuid, status public.course_status, courses bigint, duration_ms bigint)
language sql
stable
set search_path = ''
as $$
  select user_id, status, count(*), coalesce(sum(duration_ms), 0)::bigint
  from public.courses
  group by user_id, status;
$$;

revoke execute on function admin_spend_by_month(int) from public, anon, authenticated;
revoke execute on function admin_spend_by_user(timestamptz) from public, anon, authenticated;
revoke execute on function admin_spend_breakdown(timestamptz, uuid) from public, anon, authenticated;
revoke execute on function admin_course_counts() from public, anon, authenticated;
grant execute on function admin_spend_by_month(int) to service_role;
grant execute on function admin_spend_by_user(timestamptz) to service_role;
grant execute on function admin_spend_breakdown(timestamptz, uuid) to service_role;
grant execute on function admin_course_counts() to service_role;
