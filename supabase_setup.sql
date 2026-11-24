-- Shared quiz library for the GCSE Maths Quiz Engine.
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- BEFORE YOU RUN IT: replace REPLACE_WITH_SHARED_EMAIL (one place, below) with
-- the email address of the shared library user you created under
-- Authentication -> Users. Keep the single quotes.

-- 1. The only person the database will let in: the shared library user.
create or replace function public.is_library_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (auth.jwt() ->> 'email') = 'REPLACE_WITH_SHARED_EMAIL'
$$;

-- 2. One table of saved quizzes. A quiz is just a name, who made it, and its
--    quiz code. No pupil data is ever stored here.
create table if not exists public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  author     text check (char_length(author) <= 60),
  notes      text check (char_length(notes) <= 500),
  code       text not null check (char_length(code) between 9 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 3. Lock the table down. With row level security on and no policy for
--    anyone else, the public (anon) key can read and write nothing.
alter table public.quizzes enable row level security;

drop policy if exists "library user can read"   on public.quizzes;
drop policy if exists "library user can add"    on public.quizzes;
drop policy if exists "library user can edit"   on public.quizzes;

create policy "library user can read" on public.quizzes
  for select to authenticated using (public.is_library_user());
create policy "library user can add" on public.quizzes
  for insert to authenticated with check (public.is_library_user());
create policy "library user can edit" on public.quizzes
  for update to authenticated using (public.is_library_user()) with check (public.is_library_user());

-- Deliberately NO delete policy: "Delete" in the app only hides a quiz
-- (it sets deleted_at), so a mistaken delete can be undone from the Table
-- Editor by clearing that column.

-- 4. Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();

create index if not exists quizzes_created_idx on public.quizzes (created_at desc);
