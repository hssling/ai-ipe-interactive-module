-- Learning analytics and end-of-course reporting for the standalone AI/IPE
-- Supabase project. This migration stores only learning metadata and scores;
-- learner evidence remains in ai_ipe_module_progress. Do not place patient or
-- identifiable workplace information in event metadata.

-- Keep the standalone profile display name aligned with the module's own
-- sign-in metadata (the frontend supplies display_name rather than relying on
-- an email-derived label).
create or replace function private.handle_new_module_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.module_profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Participant'
    )
  )
  on conflict (user_id) do update set display_name = excluded.display_name;
  return new;
end;
$$;

alter function private.handle_new_module_user() owner to postgres;
revoke all on function private.handle_new_module_user() from public, anon, authenticated;

create table if not exists public.ai_ipe_module_schedule (
  activity_key text primary key check (activity_key ~ '^[a-z0-9_-]+$'),
  label text not null,
  starts_at timestamptz not null,
  due_at timestamptz not null,
  sort_order integer not null unique
);

insert into public.ai_ipe_module_schedule (activity_key, label, starts_at, due_at, sort_order)
values
  ('pre_assessment', 'Pre-assessment', '2026-11-01 00:00:00+05:30', '2026-11-02 23:59:59+05:30', 10),
  ('a1', 'Activity 1 · Compare before you trust', '2026-11-03 00:00:00+05:30', '2026-11-07 23:59:59+05:30', 20),
  ('a2', 'Activity 2 · Build one shared plan', '2026-11-08 00:00:00+05:30', '2026-11-15 23:59:59+05:30', 30),
  ('a3a', 'Activity 3A · Design an AI-supported IPE intervention', '2026-11-16 00:00:00+05:30', '2026-11-22 23:59:59+05:30', 40),
  ('a3b', 'Activity 3B · Sustainability appraisal', '2026-11-23 00:00:00+05:30', '2026-11-27 23:59:59+05:30', 50),
  ('close', 'Reflection, post-assessment and feedback', '2026-11-28 00:00:00+05:30', '2026-11-30 23:59:59+05:30', 60),
  ('module', 'Whole module submission', '2026-11-01 00:00:00+05:30', '2026-11-30 23:59:59+05:30', 100)
on conflict (activity_key) do update set
  label = excluded.label,
  starts_at = excluded.starts_at,
  due_at = excluded.due_at,
  sort_order = excluded.sort_order;

alter table public.ai_ipe_module_schedule enable row level security;
revoke all on public.ai_ipe_module_schedule from anon, authenticated;
grant select on public.ai_ipe_module_schedule to authenticated;
drop policy if exists "authenticated can read module schedule" on public.ai_ipe_module_schedule;
create policy "authenticated can read module schedule"
  on public.ai_ipe_module_schedule for select to authenticated using (true);

alter table public.ai_ipe_module_progress
  add column if not exists started_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_saved_at timestamptz,
  add column if not exists completion_percent smallint not null default 0
    check (completion_percent between 0 and 100),
  add column if not exists activity_status jsonb not null default '{}'::jsonb;

create table if not exists public.ai_ipe_module_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.module_profiles(user_id) on delete cascade,
  event_type text not null check (event_type in (
    'session_started', 'record_saved', 'assessment_captured',
    'activity_started', 'activity_completed', 'resource_opened',
    'video_opened', 'slide_progressed', 'module_submitted',
    'certificate_downloaded'
  )),
  activity_key text check (activity_key is null or activity_key ~ '^[a-z0-9_-]+$'),
  session_id text check (session_id is null or char_length(session_id) between 8 and 120),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index if not exists ai_ipe_module_events_user_time_idx
  on public.ai_ipe_module_events (user_id, occurred_at desc);
create index if not exists ai_ipe_module_events_type_time_idx
  on public.ai_ipe_module_events (event_type, occurred_at desc);

alter table public.ai_ipe_module_events enable row level security;
revoke all on public.ai_ipe_module_events from anon, authenticated;
grant select, insert on public.ai_ipe_module_events to authenticated;
drop policy if exists "learners read own module events" on public.ai_ipe_module_events;
drop policy if exists "learners record own module events" on public.ai_ipe_module_events;
create policy "learners read own module events"
  on public.ai_ipe_module_events for select to authenticated
  using (user_id = auth.uid() or private.is_ai_ipe_module_reviewer());
create policy "learners record own module events"
  on public.ai_ipe_module_events for insert to authenticated
  with check (user_id = auth.uid());

create table if not exists public.ai_ipe_module_assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.module_profiles(user_id) on delete cascade,
  assessment_type text not null check (assessment_type in ('pre', 'post')),
  assessment_version text not null default '2026.11-v1',
  knowledge_score smallint not null check (knowledge_score between 0 and 10),
  knowledge_max smallint not null default 10 check (knowledge_max between 1 and 100),
  confidence_total smallint not null check (confidence_total between 0 and 40),
  confidence_max smallint not null default 40 check (confidence_max between 1 and 100),
  confidence_mean numeric(5,2) generated always as (round(confidence_total::numeric / nullif(confidence_max, 0) * 5, 2)) stored,
  captured_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object')
);

create index if not exists ai_ipe_module_assessments_user_time_idx
  on public.ai_ipe_module_assessment_attempts (user_id, assessment_type, captured_at desc);

alter table public.ai_ipe_module_assessment_attempts enable row level security;
revoke all on public.ai_ipe_module_assessment_attempts from anon, authenticated;
grant select, insert on public.ai_ipe_module_assessment_attempts to authenticated;
drop policy if exists "learners read own assessment attempts" on public.ai_ipe_module_assessment_attempts;
drop policy if exists "learners record own assessment attempts" on public.ai_ipe_module_assessment_attempts;
create policy "learners read own assessment attempts"
  on public.ai_ipe_module_assessment_attempts for select to authenticated
  using (user_id = auth.uid() or private.is_ai_ipe_module_reviewer());
create policy "learners record own assessment attempts"
  on public.ai_ipe_module_assessment_attempts for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "reviewers read module profiles" on public.module_profiles;
create policy "reviewers read module profiles"
  on public.module_profiles for select to authenticated
  using (user_id = auth.uid() or private.is_admin() or private.is_ai_ipe_module_reviewer());

create or replace view public.ai_ipe_module_reporting
with (security_invoker = true)
as
with event_stats as (
  select
    user_id,
    min(occurred_at) as first_seen_at,
    max(occurred_at) as last_event_at,
    count(*)::integer as event_count,
    count(distinct (occurred_at at time zone 'Asia/Kolkata')::date)::integer as active_days,
    count(*) filter (where event_type = 'session_started')::integer as session_count,
    count(*) filter (where event_type = 'activity_completed')::integer as completed_activity_events
  from public.ai_ipe_module_events
  group by user_id
), activity_completion as (
  select
    e.user_id,
    e.activity_key,
    min(e.occurred_at) as completed_at,
    s.starts_at,
    s.due_at
  from public.ai_ipe_module_events e
  join public.ai_ipe_module_schedule s on s.activity_key = e.activity_key
  where e.event_type = 'activity_completed'
  group by e.user_id, e.activity_key, s.starts_at, s.due_at
), activity_stats as (
  select
    user_id,
    count(*)::integer as activities_completed,
    count(*) filter (where completed_at >= starts_at and completed_at <= due_at)::integer as activities_on_time,
    jsonb_object_agg(activity_key, jsonb_build_object(
      'completed_at', completed_at,
      'due_at', due_at,
      'on_time', completed_at >= starts_at and completed_at <= due_at
    )) as activity_timing
  from activity_completion
  group by user_id
), latest_pre as (
  select distinct on (user_id) user_id, knowledge_score, knowledge_max, confidence_total, confidence_max, confidence_mean, captured_at
  from public.ai_ipe_module_assessment_attempts
  where assessment_type = 'pre'
  order by user_id, captured_at desc
), latest_post as (
  select distinct on (user_id) user_id, knowledge_score, knowledge_max, confidence_total, confidence_max, confidence_mean, captured_at
  from public.ai_ipe_module_assessment_attempts
  where assessment_type = 'post'
  order by user_id, captured_at desc
), feedback as (
  select
    user_id,
    case when (learner_record -> 'fields' ->> 'f0') ~ '^[1-5]$'
      and (learner_record -> 'fields' ->> 'f1') ~ '^[1-5]$'
      and (learner_record -> 'fields' ->> 'f2') ~ '^[1-5]$'
      and (learner_record -> 'fields' ->> 'f3') ~ '^[1-5]$'
      then round((
        (learner_record -> 'fields' ->> 'f0')::numeric +
        (learner_record -> 'fields' ->> 'f1')::numeric +
        (learner_record -> 'fields' ->> 'f2')::numeric +
        (learner_record -> 'fields' ->> 'f3')::numeric
      ) / 4, 2) end as feedback_mean
  from public.ai_ipe_module_progress
)
select
  mp.user_id,
  mp.display_name,
  coalesce(p.learner_name, mp.display_name) as learner_name,
  coalesce(p.completion_status, 'not_started') as completion_status,
  coalesce(p.completion_percent, 0) as completion_percent,
  p.started_at,
  coalesce(p.last_activity_at, es.last_event_at, p.updated_at) as last_activity_at,
  es.first_seen_at,
  es.active_days,
  es.session_count,
  es.event_count,
  coalesce(ast.activities_completed, 0) as activities_completed,
  coalesce(ast.activities_on_time, 0) as activities_on_time,
  coalesce(ast.activity_timing, '{}'::jsonb) as activity_timing,
  p.submitted_at,
  case
    when p.submitted_at is null then 'not_submitted'
    when p.submitted_at <= (select due_at from public.ai_ipe_module_schedule where activity_key = 'module') then 'on_time'
    else 'late'
  end as submission_timeliness,
  lp.knowledge_score as pre_knowledge_score,
  lp.knowledge_max as pre_knowledge_max,
  lpost.knowledge_score as post_knowledge_score,
  lpost.knowledge_max as post_knowledge_max,
  (lpost.knowledge_score - lp.knowledge_score) as knowledge_gain,
  lp.confidence_mean as pre_confidence_mean,
  lpost.confidence_mean as post_confidence_mean,
  round(lpost.confidence_mean - lp.confidence_mean, 2) as confidence_gain,
  f.feedback_mean,
  coalesce(p.learner_record -> 'fields' ->> 'profession', '') as profession,
  coalesce(p.learner_record -> 'fields' ->> 'group', '') as group_id,
  p.created_at,
  p.updated_at
from public.module_profiles mp
left join public.ai_ipe_module_progress p on p.user_id = mp.user_id
left join event_stats es on es.user_id = mp.user_id
left join activity_stats ast on ast.user_id = mp.user_id
left join latest_pre lp on lp.user_id = mp.user_id
left join latest_post lpost on lpost.user_id = mp.user_id
left join feedback f on f.user_id = mp.user_id
where mp.role = 'learner';

grant select on public.ai_ipe_module_reporting to authenticated;

create or replace view public.ai_ipe_course_report
with (security_invoker = true)
as
select
  now() as generated_at,
  count(*)::integer as registered_learners,
  count(*) filter (where completion_status <> 'not_started')::integer as started_learners,
  count(*) filter (where completion_status in ('submitted', 'approved'))::integer as submitted_learners,
  count(*) filter (where completion_status = 'approved')::integer as approved_learners,
  count(*) filter (where completion_percent = 100)::integer as fully_complete_learners,
  count(*) filter (where submission_timeliness = 'on_time')::integer as on_time_submissions,
  count(*) filter (where submission_timeliness = 'late')::integer as late_submissions,
  round(100.0 * count(*) filter (where completion_status = 'approved') / nullif(count(*), 0), 1) as approval_rate_percent,
  round(100.0 * count(*) filter (where completion_status <> 'not_started') / nullif(count(*), 0), 1) as engagement_rate_percent,
  round(100.0 * count(*) filter (where submission_timeliness = 'on_time') / nullif(count(*) filter (where submitted_at is not null), 0), 1) as on_time_rate_percent,
  round(avg(pre_knowledge_score), 2) as mean_pre_knowledge,
  round(avg(post_knowledge_score), 2) as mean_post_knowledge,
  round(avg(knowledge_gain), 2) as mean_knowledge_gain,
  round(avg(pre_confidence_mean), 2) as mean_pre_confidence,
  round(avg(post_confidence_mean), 2) as mean_post_confidence,
  round(avg(confidence_gain), 2) as mean_confidence_gain,
  round(avg(feedback_mean), 2) as mean_feedback,
  round(avg(active_days), 2) as mean_active_days,
  round(avg(session_count), 2) as mean_sessions,
  round(avg(event_count), 2) as mean_events,
  round(avg(activities_completed), 2) as mean_activities_completed,
  round(avg(activities_on_time), 2) as mean_activities_on_time
from public.ai_ipe_module_reporting;

grant select on public.ai_ipe_course_report to authenticated;
