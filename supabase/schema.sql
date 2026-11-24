-- Goliath Strength Trainer: one private row per signed-in person.
-- Already applied to the goliath-fit project; kept here as the record of the schema.

create table if not exists public.goliath_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security: each person can only ever read or change their own row.
alter table public.goliath_data enable row level security;

create policy "Read own data"   on public.goliath_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own data" on public.goliath_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own data" on public.goliath_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own data" on public.goliath_data for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get nothing; signed-in users only reach rows the policies allow.
revoke all on public.goliath_data from anon;
grant select, insert, update, delete on public.goliath_data to authenticated;
