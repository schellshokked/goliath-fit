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


-- =====================================================================
-- Migration "goliath_program_shares": programs sent between accepted friends.
-- The recipient adds a copy to their own builds; weights and history are never included.
create table public.goliath_program_shares (
  id          uuid primary key default gen_random_uuid(),
  sender      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sender_name text not null default '',
  recipient   uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  kind        text not null check (kind in ('day','week','program')),
  note        text not null default '' check (char_length(note) <= 300),
  program     jsonb not null check (octet_length(program::text) < 200000),
  created_at  timestamptz not null default now()
);
create index goliath_program_shares_recipient_idx on public.goliath_program_shares (recipient, created_at desc);
create index goliath_program_shares_sender_idx on public.goliath_program_shares (sender);
alter table public.goliath_program_shares enable row level security;
create policy "See programs you sent or received" on public.goliath_program_shares for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));
create policy "Send programs to friends" on public.goliath_program_shares for insert to authenticated
  with check (sender = (select auth.uid()) and recipient <> (select auth.uid())
              and private.goliath_are_friends((select auth.uid()), recipient));
create policy "Either side can delete" on public.goliath_program_shares for delete to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));
revoke all on public.goliath_program_shares from anon;
grant select, insert, delete on public.goliath_program_shares to authenticated;


-- =====================================================================
-- Migration "goliath_presence_messages": online status and direct messages between friends.
alter table public.goliath_profiles
  add column last_seen timestamptz,
  add column activity  text not null default '' check (char_length(activity) <= 80),
  add column presence  boolean not null default true;

create table public.goliath_messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  recipient  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index goliath_messages_recipient_idx on public.goliath_messages (recipient, created_at desc);
create index goliath_messages_sender_idx on public.goliath_messages (sender, created_at desc);
alter table public.goliath_messages enable row level security;
create policy "See your own conversations" on public.goliath_messages for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));
create policy "Message your friends" on public.goliath_messages for insert to authenticated
  with check (sender = (select auth.uid()) and recipient <> (select auth.uid()) and read_at is null
              and private.goliath_are_friends((select auth.uid()), recipient));
create policy "Recipient marks read" on public.goliath_messages for update to authenticated
  using (recipient = (select auth.uid())) with check (recipient = (select auth.uid()));
create policy "Sender can unsend" on public.goliath_messages for delete to authenticated
  using (sender = (select auth.uid()));
revoke all on public.goliath_messages from anon;
grant select, insert, delete on public.goliath_messages to authenticated;
grant update (read_at) on public.goliath_messages to authenticated;
alter publication supabase_realtime add table public.goliath_messages;


-- =====================================================================
-- Migration "goliath_push_notifications": web push subscriptions, settings, triggers and the reminder timer.
-- VAPID keys and the trigger secret are stored in Supabase Vault (goliath_vapid_private, goliath_vapid_public, goliath_hook_secret).
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.goliath_push_subs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint   text not null unique check (endpoint like 'https://%'),
  p256dh     text not null,
  auth       text not null,
  ua         text not null default '',
  created_at timestamptz not null default now()
);
create index goliath_push_subs_user_idx on public.goliath_push_subs (user_id);
alter table public.goliath_push_subs enable row level security;
create policy "See own devices" on public.goliath_push_subs for select to authenticated using (user_id = (select auth.uid()));
create policy "Remove own devices" on public.goliath_push_subs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.goliath_push_subs from anon;
grant select, delete on public.goliath_push_subs to authenticated;

create or replace function public.goliath_save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_ua text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.goliath_push_subs where endpoint = p_endpoint;
  insert into public.goliath_push_subs(user_id, endpoint, p256dh, auth, ua) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_ua,''), 200));
end $$;
revoke all on function public.goliath_save_push_sub(text, text, text, text) from public, anon;
grant execute on function public.goliath_save_push_sub(text, text, text, text) to authenticated;

create table public.goliath_notify_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  messages        boolean not null default true,
  requests        boolean not null default true,
  programs        boolean not null default true,
  friend_workouts boolean not null default true,
  reminders       boolean not null default false,
  remind_days     smallint[] not null default '{}',
  remind_time     time not null default '18:00',
  weekly          boolean not null default true,
  tz              text not null default 'America/New_York',
  last_reminded   date,
  last_weekly     date,
  updated_at      timestamptz not null default now()
);
alter table public.goliath_notify_prefs enable row level security;
create policy "Own notification settings" on public.goliath_notify_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.goliath_notify_prefs from anon;
grant select, insert, update on public.goliath_notify_prefs to authenticated;

create or replace function public.goliath_push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
  where name in ('goliath_vapid_private','goliath_vapid_public','goliath_hook_secret');
$$;
revoke all on function public.goliath_push_config() from public, anon, authenticated;
grant execute on function public.goliath_push_config() to service_role;

create or replace function private.goliath_push(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'goliath_hook_secret';
  perform net.http_post(
    url := 'https://djmdcwchmxzraxsafwxb.supabase.co/functions/v1/goliath-push',
    body := payload,
    headers := jsonb_build_object('Content-Type','application/json','x-goliath-hook', s),
    timeout_milliseconds := 8000);
exception when others then null;
end $$;
revoke all on function private.goliath_push(jsonb) from public, anon, authenticated;

create or replace function private.goliath_push_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'goliath_friends' and tg_op = 'INSERT' then
    perform private.goliath_push(jsonb_build_object('kind','request','record',to_jsonb(new)));
  elsif tg_table_name = 'goliath_friends' and tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.goliath_push(jsonb_build_object('kind','accepted','record',to_jsonb(new)));
  elsif tg_table_name = 'goliath_messages' then
    perform private.goliath_push(jsonb_build_object('kind','message','record',to_jsonb(new)));
  elsif tg_table_name = 'goliath_program_shares' then
    perform private.goliath_push(jsonb_build_object('kind','program','record',to_jsonb(new) - 'program'));
  elsif tg_table_name = 'goliath_workouts' then
    perform private.goliath_push(jsonb_build_object('kind','workout','record',to_jsonb(new)));
  end if;
  return null;
end $$;

create trigger goliath_push_friends after insert or update on public.goliath_friends for each row execute function private.goliath_push_trigger();
create trigger goliath_push_messages after insert on public.goliath_messages for each row execute function private.goliath_push_trigger();
create trigger goliath_push_programs after insert on public.goliath_program_shares for each row execute function private.goliath_push_trigger();
create trigger goliath_push_workouts after insert on public.goliath_workouts for each row execute function private.goliath_push_trigger();

select cron.schedule('goliath-push-tick', '*/15 * * * *', $$select private.goliath_push('{"kind":"tick"}'::jsonb)$$);

-- Migration "goliath_push_service_grants": the sender runs as service_role, which this project doesn't grant by default.
grant select on public.goliath_profiles, public.goliath_friends, public.goliath_workouts, public.goliath_notify_prefs, public.goliath_push_subs to service_role;
grant update (last_reminded, last_weekly) on public.goliath_notify_prefs to service_role;
grant delete on public.goliath_push_subs to service_role;
