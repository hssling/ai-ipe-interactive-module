-- Performance and exposure tuning for the standalone analytics rollout.
-- Policies retain the same ownership/reviewer boundaries while evaluating
-- auth.uid() once per statement.

drop policy if exists "users read own module profile" on public.module_profiles;
drop policy if exists "reviewers read module profiles" on public.module_profiles;
create policy "learners and reviewers read module profiles"
  on public.module_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
    or (select private.is_ai_ipe_module_reviewer())
  );

drop policy if exists "learners see their own AI IPE record" on public.ai_ipe_module_progress;
drop policy if exists "reviewers see submitted AI IPE records" on public.ai_ipe_module_progress;
create policy "learners and reviewers read AI IPE records"
  on public.ai_ipe_module_progress for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ai_ipe_module_reviewer()));

drop policy if exists "learner creates own AI IPE record" on public.ai_ipe_module_progress;
create policy "learner creates own AI IPE record"
  on public.ai_ipe_module_progress for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "learner updates own AI IPE record" on public.ai_ipe_module_progress;
create policy "learner updates own AI IPE record"
  on public.ai_ipe_module_progress for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "learners read own module events" on public.ai_ipe_module_events;
create policy "learners read own module events"
  on public.ai_ipe_module_events for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ai_ipe_module_reviewer()));
drop policy if exists "learners record own module events" on public.ai_ipe_module_events;
create policy "learners record own module events"
  on public.ai_ipe_module_events for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "learners read own assessment attempts" on public.ai_ipe_module_assessment_attempts;
create policy "learners read own assessment attempts"
  on public.ai_ipe_module_assessment_attempts for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ai_ipe_module_reviewer()));
drop policy if exists "learners record own assessment attempts" on public.ai_ipe_module_assessment_attempts;
create policy "learners record own assessment attempts"
  on public.ai_ipe_module_assessment_attempts for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "certificate visible to learner or reviewer" on public.ai_ipe_module_certificates;
create policy "certificate visible to learner or reviewer"
  on public.ai_ipe_module_certificates for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_ai_ipe_module_reviewer()));

create or replace function public.is_ai_ipe_module_reviewer()
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$ select private.is_ai_ipe_module_reviewer(); $$;

revoke all on function public.rls_auto_enable() from anon, authenticated;
