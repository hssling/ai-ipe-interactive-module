-- Secure, standalone persistence for the FAIMER Group 2 AI/IPE module.
-- It deliberately reuses the Learning Compass identity and institutional
-- boundary instead of creating a second set of user accounts.

create table if not exists public.ai_ipe_module_facilitators (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  assigned_by uuid not null references public.profiles(user_id),
  assigned_at timestamptz not null default now()
);

create or replace function private.is_ai_ipe_module_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.is_admin()
      or exists (
        select 1
        from public.ai_ipe_module_facilitators f
        where f.user_id = auth.uid()
      );
$$;

revoke all on function private.is_ai_ipe_module_reviewer() from public, anon;
grant execute on function private.is_ai_ipe_module_reviewer() to authenticated;

create table if not exists public.ai_ipe_module_progress (
  user_id uuid primary key references public.student_profiles(user_id) on delete cascade,
  learner_name text not null check (char_length(trim(learner_name)) between 2 and 160),
  learner_record jsonb not null default '{}'::jsonb,
  completion_status text not null default 'draft'
    check (completion_status in ('draft', 'submitted', 'needs_revision', 'approved')),
  submitted_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2500),
  reviewed_by uuid references public.profiles(user_id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_ipe_module_progress_review_idx
  on public.ai_ipe_module_progress (completion_status, submitted_at desc);

create table if not exists public.ai_ipe_module_certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.student_profiles(user_id) on delete cascade,
  certificate_code text not null unique
    check (certificate_code ~ '^FAIMER-AIIPE-2026-[A-Z0-9]{10}$'),
  participant_name text not null check (char_length(trim(participant_name)) between 2 and 160),
  module_title text not null default 'Using AI as a catalyst for interprofessional learning',
  module_period text not null default '1–30 November 2026',
  issued_on date not null default current_date,
  issued_by uuid not null references public.profiles(user_id),
  verifier_name text not null check (char_length(trim(verifier_name)) between 2 and 160),
  completion_record jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists ai_ipe_module_certificates_lookup_idx
  on public.ai_ipe_module_certificates (certificate_code);

create or replace function public.set_ai_ipe_module_progress_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_ai_ipe_module_progress_updated_at() from public, anon, authenticated;

create or replace function public.guard_ai_ipe_module_progress()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then
      raise exception 'A learner may only create their own module record';
    end if;
    if new.completion_status not in ('draft', 'submitted')
       or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'Only a draft or submission can be created by a learner';
    end if;
    if new.completion_status = 'submitted' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if private.is_ai_ipe_module_reviewer() then
    -- Review decisions are made only through the audited RPC functions below.
    if new.learner_record is distinct from old.learner_record
       or new.learner_name is distinct from old.learner_name then
      raise exception 'Reviewers cannot alter learner evidence';
    end if;
    return new;
  end if;

  if new.user_id <> auth.uid() then
    raise exception 'A learner may only update their own module record';
  end if;
  if old.completion_status = 'approved' then
    raise exception 'An approved record is immutable';
  end if;
  if new.completion_status not in ('draft', 'submitted') then
    raise exception 'Learners may only save a draft or submit for review';
  end if;
  if new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.review_note is distinct from old.review_note then
    raise exception 'Learners cannot alter the review decision';
  end if;
  if new.completion_status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.guard_ai_ipe_module_progress() from public, anon, authenticated;

drop trigger if exists ai_ipe_module_progress_updated_at on public.ai_ipe_module_progress;
create trigger ai_ipe_module_progress_updated_at
  before update on public.ai_ipe_module_progress
  for each row execute function public.set_ai_ipe_module_progress_updated_at();

drop trigger if exists guard_ai_ipe_module_progress on public.ai_ipe_module_progress;
create trigger guard_ai_ipe_module_progress
  before insert or update on public.ai_ipe_module_progress
  for each row execute function public.guard_ai_ipe_module_progress();

alter table public.ai_ipe_module_facilitators enable row level security;
alter table public.ai_ipe_module_progress enable row level security;
alter table public.ai_ipe_module_certificates enable row level security;

revoke all on public.ai_ipe_module_facilitators, public.ai_ipe_module_progress,
  public.ai_ipe_module_certificates from anon, authenticated;
grant select on public.ai_ipe_module_facilitators to authenticated;
grant insert, update, delete on public.ai_ipe_module_facilitators to authenticated;
grant select, insert, update on public.ai_ipe_module_progress to authenticated;
grant select on public.ai_ipe_module_certificates to authenticated;

create policy "admins manage AI IPE module facilitators"
  on public.ai_ipe_module_facilitators for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy "learners see their own AI IPE record"
  on public.ai_ipe_module_progress for select to authenticated
  using (user_id = auth.uid());

create policy "reviewers see submitted AI IPE records"
  on public.ai_ipe_module_progress for select to authenticated
  using (private.is_ai_ipe_module_reviewer());

create policy "learner creates own AI IPE record"
  on public.ai_ipe_module_progress for insert to authenticated
  with check (user_id = auth.uid());

create policy "learner updates own AI IPE record"
  on public.ai_ipe_module_progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "certificate visible to learner or reviewer"
  on public.ai_ipe_module_certificates for select to authenticated
  using (user_id = auth.uid() or private.is_ai_ipe_module_reviewer());

create or replace function public.is_ai_ipe_module_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$ select private.is_ai_ipe_module_reviewer(); $$;

revoke all on function public.is_ai_ipe_module_reviewer() from public, anon;
grant execute on function public.is_ai_ipe_module_reviewer() to authenticated;

create or replace function public.approve_ai_ipe_module_completion(
  p_learner_id uuid,
  p_review_note text default null
)
returns public.ai_ipe_module_certificates
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  progress_row public.ai_ipe_module_progress;
  certificate_row public.ai_ipe_module_certificates;
  verifier text;
  new_code text;
begin
  if not private.is_ai_ipe_module_reviewer() then
    raise exception 'Only an assigned facilitator or administrator can approve completion';
  end if;

  select * into progress_row
  from public.ai_ipe_module_progress
  where user_id = p_learner_id
  for update;

  if progress_row.user_id is null then
    raise exception 'No completion record found for this learner';
  end if;
  if progress_row.completion_status <> 'submitted' then
    raise exception 'Only submitted records can be approved';
  end if;
  if progress_row.learner_record = '{}'::jsonb then
    raise exception 'Completion evidence is missing';
  end if;

  select display_name into verifier from public.profiles where user_id = auth.uid();
  verifier := coalesce(nullif(verifier, ''), 'Assigned facilitator');
  new_code := 'FAIMER-AIIPE-2026-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.ai_ipe_module_certificates (
    user_id, certificate_code, participant_name, issued_by, verifier_name, completion_record
  ) values (
    progress_row.user_id, new_code, progress_row.learner_name, auth.uid(), verifier, progress_row.learner_record
  ) returning * into certificate_row;

  update public.ai_ipe_module_progress
  set completion_status = 'approved',
      review_note = nullif(trim(coalesce(p_review_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where user_id = progress_row.user_id;

  return certificate_row;
end;
$$;

revoke all on function public.approve_ai_ipe_module_completion(uuid, text) from public, anon;
grant execute on function public.approve_ai_ipe_module_completion(uuid, text) to authenticated;

create or replace function public.return_ai_ipe_module_completion(
  p_learner_id uuid,
  p_review_note text
)
returns public.ai_ipe_module_progress
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare returned_row public.ai_ipe_module_progress;
begin
  if not private.is_ai_ipe_module_reviewer() then
    raise exception 'Only an assigned facilitator or administrator can return a record';
  end if;
  if char_length(trim(coalesce(p_review_note, ''))) < 3 then
    raise exception 'Provide a concise revision note for the learner';
  end if;

  update public.ai_ipe_module_progress
  set completion_status = 'needs_revision',
      review_note = trim(p_review_note),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where user_id = p_learner_id and completion_status = 'submitted'
  returning * into returned_row;

  if returned_row.user_id is null then
    raise exception 'Only a submitted record can be returned for revision';
  end if;
  return returned_row;
end;
$$;

revoke all on function public.return_ai_ipe_module_completion(uuid, text) from public, anon;
grant execute on function public.return_ai_ipe_module_completion(uuid, text) to authenticated;

