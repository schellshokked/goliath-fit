-- Goliath Strength Trainer: one private row per signed-in person.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.goliath_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security: each person can only ever read or change their own row.
alter table public.goliath_data enable row level security;

drop policy if exists "Read own data"   on public.goliath_data;
drop policy if exists "Insert own data" on public.goliath_data;
drop policy if exists "Update own data" on public.goliath_data;
drop policy if exists "Delete own data" on public.goliath_data;

create policy "Read own data"   on public.goliath_data for select to authenticated using (auth.uid() = user_id);
create policy "Insert own data" on public.goliath_data for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own data" on public.goliath_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own data" on public.goliath_data for delete to authenticated using (auth.uid() = user_id);
