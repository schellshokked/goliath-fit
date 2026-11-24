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


-- =====================================================================
-- Goliath Social (migration "goliath_social"): profiles, friend requests by email, and shared workout summaries.
-- Nothing is visible to anyone until both people have accepted the friendship.

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.goliath_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  email      text not null,
  name       text not null default '',
  share      boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index goliath_profiles_email_idx on public.goliath_profiles (lower(email));

create table public.goliath_friends (
  id              uuid primary key default gen_random_uuid(),
  requester       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  requester_name  text not null default '',
  requester_email text not null,
  addressee_email text not null check (addressee_email = lower(addressee_email)),
  addressee       uuid references auth.users(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','accepted')),
  created_at      timestamptz not null default now(),
  unique (requester, addressee_email)
);
create index goliath_friends_addressee_email_idx on public.goliath_friends (addressee_email);
create index goliath_friends_addressee_idx on public.goliath_friends (addressee);

create table public.goliath_workouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  done_at    timestamptz not null default now(),
  day_name   text not null default '',
  plan_name  text not null default '',
  rating     smallint check (rating between 1 and 5),
  sets_done  integer not null default 0,
  highlights jsonb not null default '[]'::jsonb,
  unit       text not null default 'lb' check (unit in ('lb','kg'))
);
create index goliath_workouts_user_done_idx on public.goliath_workouts (user_id, done_at desc);

create or replace function private.goliath_are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.goliath_friends f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;
create or replace function private.goliath_shares(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.share from public.goliath_profiles p where p.user_id = u), true);
$$;
revoke all on function private.goliath_are_friends(uuid, uuid) from public, anon;
revoke all on function private.goliath_shares(uuid) from public, anon;
grant execute on function private.goliath_are_friends(uuid, uuid) to authenticated;
grant execute on function private.goliath_shares(uuid) to authenticated;

alter table public.goliath_profiles enable row level security;
alter table public.goliath_friends  enable row level security;
alter table public.goliath_workouts enable row level security;

create policy "See own and friends' profiles" on public.goliath_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.goliath_are_friends((select auth.uid()), user_id));
create policy "Create own profile" on public.goliath_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and lower(email) = lower((select auth.jwt()) ->> 'email'));
create policy "Update own profile" on public.goliath_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and lower(email) = lower((select auth.jwt()) ->> 'email'));

create policy "See requests you sent or received" on public.goliath_friends for select to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid())
         or addressee_email = lower((select auth.jwt()) ->> 'email'));
create policy "Send requests as yourself" on public.goliath_friends for insert to authenticated
  with check (requester = (select auth.uid())
              and lower(requester_email) = lower((select auth.jwt()) ->> 'email')
              and addressee_email <> lower((select auth.jwt()) ->> 'email')
              and addressee is null and status = 'pending');
create policy "Recipient claims or accepts" on public.goliath_friends for update to authenticated
  using (addressee_email = lower((select auth.jwt()) ->> 'email'))
  with check (addressee_email = lower((select auth.jwt()) ->> 'email') and addressee = (select auth.uid()));
create policy "Either side can remove" on public.goliath_friends for delete to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid())
         or addressee_email = lower((select auth.jwt()) ->> 'email'));

create policy "See own and friends' workouts" on public.goliath_workouts for select to authenticated
  using (user_id = (select auth.uid())
         or (private.goliath_are_friends((select auth.uid()), user_id) and private.goliath_shares(user_id)));
create policy "Post own workouts" on public.goliath_workouts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Delete own workouts" on public.goliath_workouts for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.goliath_profiles, public.goliath_friends, public.goliath_workouts from anon;
grant select, insert, update on public.goliath_profiles to authenticated;
grant select, insert, delete on public.goliath_friends to authenticated;
grant update (status, addressee) on public.goliath_friends to authenticated;
grant select, insert, delete on public.goliath_workouts to authenticated;
