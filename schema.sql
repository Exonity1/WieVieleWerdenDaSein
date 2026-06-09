-- ==========================================
-- SCHEMA DEFINITIONS FOR ATTENDANCE BETTING GAME
-- Run this in your Supabase SQL Editor
-- ==========================================

-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- Drop existing tables/functions if you need to start fresh (uncomment if needed)
-- drop table if exists public.bets cascade;
-- drop table if exists public.schedule cascade;
-- drop table if exists public.profiles cascade;

-- 1. PROFILES TABLE
-- Stores user information, token balances, and admin status.
-- Linked to auth.users created by Supabase Auth.
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  tokens integer not null default 100 check (tokens >= 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- 2. SCHEDULE TABLE
-- Stores the schedule of classes, times, and resolutions.
create table public.schedule (
  id bigint generated always as identity primary key,
  class_date date not null,
  class_time timestamptz not null,
  subject text not null default 'Unterricht',
  is_resolved boolean not null default false,
  actual_attendance integer check (actual_attendance >= 0),
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- Enable Row Level Security
alter table public.schedule enable row level security;

-- 3. BETS TABLE
-- Stores student guesses and outcomes.
create table public.bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  class_id bigint not null references public.schedule(id) on delete cascade,
  guess integer not null check (guess >= 0),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  payout integer not null default 0 check (payout >= 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint unique_user_class_bet unique (user_id, class_id)
);

-- Enable Row Level Security
alter table public.bets enable row level security;


-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Profiles Policies
create policy "Allow authenticated users to read profiles" 
  on public.profiles 
  for select 
  to authenticated 
  using (true);

-- No insert or update policies are created for profiles because we do not want 
-- clients to modify profiles (e.g. altering tokens/is_admin) directly.
-- All balance updates and profile creation are handled via database triggers/RPCs.

-- Bets Policies
create policy "Allow users to read their own bets" 
  on public.bets 
  for select 
  to authenticated 
  using (auth.uid() = user_id or (select is_admin from public.profiles where id = auth.uid()));

-- No insert/update policies are created for bets because clients must insert 
-- bets only via the place_bet RPC to ensure token deduction and time locks are enforced.

-- Schedule Policies
create policy "Allow authenticated users to read schedule" 
  on public.schedule 
  for select 
  to authenticated 
  using (true);

create policy "Allow admin to manage schedule" 
  on public.schedule 
  for all 
  to authenticated 
  using ((select is_admin from public.profiles where id = auth.uid()));


-- ==========================================
-- AUTH TRIGGER FOR USER CREATION
-- ==========================================

-- Automatically inserts a profile when a new user signs up in auth.users
create or replace function public.handle_new_user()
returns trigger as $$
declare
  username_val text;
begin
  -- Use username from metadata, or split email prefix as fallback
  username_val := coalesce(
    new.raw_user_meta_data->>'username', 
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, username, tokens, is_admin)
  values (new.id, username_val, 100, false);
  
  return new;
exception
  when unique_violation then
    -- Handle username conflicts by appending a random string
    insert into public.profiles (id, username, tokens, is_admin)
    values (
      new.id, 
      username_val || '_' || substr(md5(random()::text), 1, 4), 
      100, 
      false
    );
    return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Trigger execution
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ==========================================
-- STORED PROCEDURES (RPCs)
-- ==========================================

-- RPC 1: PLACE A BET
-- Enforces 20-minute time lock, saves bet server side, and returns current token balance.
create or replace function public.place_bet(
  target_class_id bigint,
  guessed_amount integer
)
returns integer -- Returns current token balance
language plpgsql
security definer -- Runs with database owner privileges, bypassing RLS to insert/update
set search_path = public
as $$
declare
  user_id_val uuid;
  user_tokens integer;
  class_start_time timestamptz;
  class_resolved boolean;
begin
  -- 1. Verify Authentication
  user_id_val := auth.uid();
  if user_id_val is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- 2. Validate input
  if guessed_amount < 0 then
    raise exception 'Die Schätzung muss eine nicht-negative ganze Zahl sein';
  end if;

  -- 3. Fetch user profile tokens
  select tokens into user_tokens 
  from public.profiles 
  where id = user_id_val 
  for update;

  if user_tokens is null then
    raise exception 'Benutzerprofil nicht gefunden';
  end if;

  -- 4. Fetch class schedule details by ID
  select class_time, is_resolved into class_start_time, class_resolved
  from public.schedule
  where id = target_class_id;

  if class_start_time is null then
    raise exception 'Für diesen Unterricht ist kein Termin geplant';
  end if;

  if class_resolved then
    raise exception 'Dieser Unterricht wurde bereits ausgewertet';
  end if;

  -- 5. Enforce 20-minute time lock
  if now() > (class_start_time - interval '20 minutes') then
    raise exception 'Die Tipprunde für diesen Unterricht ist geschlossen (Frist war 20 Minuten vor Beginn)';
  end if;

  -- 6. Insert bet referencing class_id
  insert into public.bets (user_id, class_id, guess, status, payout)
  values (user_id_val, target_class_id, guessed_amount, 'pending', 0);

  return user_tokens;
end;
$$;


-- RPC 2: RESOLVE BETS
-- Allows admin to set actual attendance and calculates payouts.
create or replace function public.resolve_bets(
  actual_number integer,
  target_class_id bigint
)
returns integer -- Returns number of bets resolved
language plpgsql
security definer -- Runs with database owner privileges
set search_path = public
as $$
declare
  caller_id uuid;
  caller_is_admin boolean;
  bet_record record;
  payout_val integer;
  diff integer;
  resolved_count integer := 0;
begin
  -- 1. Verify caller is authenticated
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- 2. Verify caller is an admin
  select is_admin into caller_is_admin 
  from public.profiles 
  where id = caller_id;

  if caller_is_admin is not true then
    raise exception 'Nicht autorisiert. Nur Admins können Tipps auswerten.';
  end if;

  -- 3. Validate inputs
  if actual_number < 0 then
    raise exception 'Die tatsächliche Anwesenheit darf nicht negativ sein';
  end if;

  -- Verify schedule entry exists
  if not exists (select 1 from public.schedule where id = target_class_id) then
    raise exception 'Kein Unterricht mit dieser ID gefunden';
  end if;

  -- 4. Update the schedule details
  update public.schedule
  set is_resolved = true,
      actual_attendance = actual_number
  where id = target_class_id;

  -- 5. Loop and process all pending bets for this class
  for bet_record in 
    select id, user_id, guess 
    from public.bets 
    where class_id = target_class_id and status = 'pending'
  loop
    -- Calculate absolute difference (distance)
    diff := abs(bet_record.guess - actual_number);
    
    -- Determine payout
    if diff = 0 then
      payout_val := 50; -- Exact match (+50 tokens)
    elsif diff = 1 then
      payout_val := 20; -- Off by 1 (+20 tokens)
    elsif diff = 2 then
      payout_val := 10; -- Off by 2 (+10 tokens)
    else
      payout_val := 0;  -- Off by > 2 (0 tokens)
    end if;

    -- Award payout to the user's profile
    if payout_val > 0 then
      update public.profiles
      set tokens = tokens + payout_val
      where id = bet_record.user_id;
    end if;

    -- Update bet record status and payout amount
    update public.bets
    set status = case when payout_val > 0 then 'won' else 'lost' end,
        payout = payout_val
    where id = bet_record.id;

    resolved_count := resolved_count + 1;
  end loop;

  return resolved_count;
end;
$$;


-- ==========================================
-- SEED DATA (MOCK SCHEDULE FOR THE NEXT 14 DAYS)
-- ==========================================

-- Seed schedule dates relative to German Local Time / Berlin.
-- Make sure to seed dates beginning from 2026-06-08
-- Users can guess and place bets on these dates.

insert into public.schedule (class_date, class_time, subject) values
  ('2026-06-07', '2026-06-07 22:37:00+02', 'Testkurs'),
  ('2026-06-08', '2026-06-08 13:30:00+02', 'Preventive Security'),
  ('2026-06-09', '2026-06-09 09:30:00+02', 'Softwarequalität'),
  ('2026-06-10', '2026-06-10 09:15:00+02', 'Statistik'),
  ('2026-06-11', '2026-06-11 14:00:00+02', 'IT-Sicherheit'),
  ('2026-06-12', '2026-06-12 11:00:00+02', 'Praxis der Softwareentwicklung'),
  ('2026-06-15', '2026-06-15 13:30:00+02', 'Preventive Security'),
  ('2026-06-16', '2026-06-16 08:30:00+02', 'Softwarequalität'),
  ('2026-06-16', '2026-06-16 12:15:00+02', 'Praxis der Softwareentwicklung'),
  ('2026-06-17', '2026-06-17 09:15:00+02', 'Statistik'),
  ('2026-06-18', '2026-06-18 14:00:00+02', 'IT-Sicherheit'),
  ('2026-06-19', '2026-06-19 08:15:00+02', 'Statistik'),
  ('2026-06-19', '2026-06-19 11:00:00+02', 'Praxis der Softwareentwicklung')
on conflict (id) do nothing;


-- ==========================================
-- GRANT TABLE AND FUNCTION LEVEL PRIVILEGES
-- ==========================================
-- Ensure the authenticated and anon roles have table-level SELECT access.
-- Row Level Security (RLS) policies will still enforce who can see what.
grant select on public.profiles to authenticated, anon;
grant select on public.schedule to authenticated, anon;
grant select on public.bets to authenticated;

-- Revoke default PUBLIC execution permissions on SECURITY DEFINER functions to prevent anon/unauthorized execution
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.place_bet(bigint, integer) from public, anon, authenticated;
revoke execute on function public.resolve_bets(integer, bigint) from public, anon, authenticated;

-- Grant execution explicitly to the authorized roles
grant execute on function public.place_bet(bigint, integer) to authenticated;
grant execute on function public.resolve_bets(integer, bigint) to authenticated;
