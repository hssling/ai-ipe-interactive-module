-- Identity for the standalone AI/IPE module.
--
-- WHY
-- The module runs on its own Supabase project, separate from Learning
-- Compass, so it keeps its own accounts. Every signed-in user gets a
-- module profile automatically. The role is 'learner' by default; an
-- administrator is set only by the project owner in SQL, never by the
-- browser.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.module_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  role text not null default 'learner' check (role in ('learner', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.module_profiles enable row level security;
revoke all on public.module_profiles from anon, authenticated;
grant select on public.module_profiles to authenticated;

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
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Participant'
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

alter function private.handle_new_module_user() owner to postgres;
revoke all on function private.handle_new_module_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_module_profile on auth.users;
create trigger on_auth_user_created_module_profile
  after insert on auth.users
  for each row execute function private.handle_new_module_user();

-- Backfill anyone who signed up before this migration ran.
insert into public.module_profiles (user_id, display_name)
select u.id, coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Participant')
from auth.users u
on conflict (user_id) do nothing;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.module_profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

alter function private.is_admin() owner to postgres;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "users read own module profile" on public.module_profiles;
create policy "users read own module profile"
  on public.module_profiles for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
