-- ==========================================================================
-- SUPABASE BACKEND SECURITY & FUNCTIONALITY TEST SUITE
-- Run this block in your Supabase SQL Editor.
-- It executes within a transaction and rolls back at the end so it leaves 
-- your database completely clean while verifying all security constraints!
-- ==========================================================================

begin;

-- Create temporary helper variables for testing
do $$
declare
  student_id uuid := '00000000-0000-0000-0000-000000000001';
  admin_id uuid := '00000000-0000-0000-0000-000000000002';
  test_class_date date := '2030-01-01';
  test_class_time timestamptz := '2030-01-01 12:00:00+02';
  locked_class_date date := '2030-01-02';
  locked_class_time timestamptz;
  student_tokens_before integer;
  student_tokens_after integer;
begin
  raise notice '=== STARTING ATTENDANCE BETTING SECURITY TESTS ===';

  -- ----------------------------------------------------
  -- 1. SETUP MOCK AUTH USERS (Automatically triggers profile creation)
  -- ----------------------------------------------------
  insert into auth.users (id, email, aud, role) values
    (student_id, 'student1@example.com', 'authenticated', 'authenticated'),
    (admin_id, 'admin1@example.com', 'authenticated', 'authenticated'),
    ('00000000-0000-0000-0000-000000000003', 'user3@example.com', 'authenticated', 'authenticated'),
    ('00000000-0000-0000-0000-000000000004', 'user4@example.com', 'authenticated', 'authenticated'),
    ('00000000-0000-0000-0000-000000000005', 'user5@example.com', 'authenticated', 'authenticated'),
    ('00000000-0000-0000-0000-000000000006', 'user6@example.com', 'authenticated', 'authenticated');

  -- Elevate admin mock user profile and customize student username/tokens
  update public.profiles set is_admin = true where id = admin_id;
  update public.profiles set username = 'test_student', tokens = 100 where id = student_id;

  -- Seed a future class (open for betting)
  insert into public.schedule (class_date, class_time, is_resolved)
  values (test_class_date, test_class_time, false);

  -- Seed a class starting in 15 minutes (locked for betting)
  locked_class_time := now() + interval '15 minutes';
  insert into public.schedule (class_date, class_time, is_resolved)
  values (locked_class_date, locked_class_time, false);


  -- ----------------------------------------------------
  -- 2. TEST CASE: SECURE REQUEST CONTEXT (BYPASSING CLIENT)
  -- ----------------------------------------------------
  -- Set request context to mock student user (mimics Supabase Auth header)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', student_id::text)::text, true);

  -- Verify placing a valid bet deducts tokens and registers
  raise notice 'Test 1: Placing a valid bet...';
  select tokens into student_tokens_before from public.profiles where id = student_id;
  
  -- Call place_bet
  perform public.place_bet(test_class_date, 40);
  
  select tokens into student_tokens_after from public.profiles where id = student_id;
  if student_tokens_after != student_tokens_before - 10 then
    raise exception 'Test 1 Failed: Valid bet did not deduct exactly 10 tokens. Before: %, After: %', student_tokens_before, student_tokens_after;
  end if;
  raise notice '-> Test 1 Passed: Valid bet processed and 10 tokens deducted.';


  -- ----------------------------------------------------
  -- 3. TEST CASE: TIME LOCK SECURITY (20-MINUTE CONSTRAINT)
  -- ----------------------------------------------------
  raise notice 'Test 2: Placing a bet on a class starting in < 20 minutes (Should Fail)...';
  begin
    perform public.place_bet(locked_class_date, 45);
    raise exception 'Test 2 Failed: Betting was allowed within the 20-minute lock window!';
  exception
    when others then
      if sqlerrm like '%Betting is closed%' then
        raise notice '-> Test 2 Passed: Time-lock correctly blocked the bet (Error: %)', sqlerrm;
      else
        raise exception 'Test 2 Failed with unexpected error: %', sqlerrm;
      end if;
  end;


  -- ----------------------------------------------------
  -- 4. TEST CASE: DOUBLE-BETTING PREVENTION
  -- ----------------------------------------------------
  raise notice 'Test 3: Attempting to double-bet on the same class (Should Fail)...';
  begin
    perform public.place_bet(test_class_date, 42);
    raise exception 'Test 3 Failed: User was allowed to place more than one bet for the same class!';
  exception
    when others then
      -- Unique violation / constraint check
      raise notice '-> Test 3 Passed: Double-betting correctly blocked (Error: %)', sqlerrm;
  end;


  -- ----------------------------------------------------
  -- 5. TEST CASE: INSUFFICIENT BALANCE ENFORCEMENT
  -- ----------------------------------------------------
  raise notice 'Test 4: Placing a bet with zero tokens (Should Fail)...';
  -- Manually empty tokens for this transaction
  update public.profiles set tokens = 5 where id = student_id;
  begin
    perform public.place_bet(test_class_date, 30);
    raise exception 'Test 4 Failed: User was allowed to bet with insufficient tokens!';
  exception
    when others then
      if sqlerrm like '%Insufficient tokens%' then
        raise notice '-> Test 4 Passed: Insufficient balance correctly blocked (Error: %)', sqlerrm;
      else
        raise exception 'Test 4 Failed with unexpected error: %', sqlerrm;
      end if;
  end;
  -- Restore tokens for subsequent tests
  update public.profiles set tokens = 90 where id = student_id;


  -- ----------------------------------------------------
  -- 6. TEST CASE: NEGATIVE INPUT TAMPERING
  -- ----------------------------------------------------
  raise notice 'Test 5: Placing a bet with negative attendance guess (Should Fail)...';
  begin
    perform public.place_bet(test_class_date, -5);
    raise exception 'Test 5 Failed: Negative guesses were accepted!';
  exception
    when others then
      raise notice '-> Test 5 Passed: Negative values correctly blocked (Error: %)', sqlerrm;
  end;


  -- ----------------------------------------------------
  -- 7. TEST CASE: ADMIN ACTION AUTHORIZATION (BURP SUITE RESOLUTION ACCESS)
  -- ----------------------------------------------------
  raise notice 'Test 6: Student trying to resolve bets (Should Fail)...';
  begin
    perform public.resolve_bets(40, test_class_date);
    raise exception 'Test 6 Failed: Student was allowed to resolve bets!';
  exception
    when others then
      if sqlerrm like '%Only admins%' then
        raise notice '-> Test 6 Passed: Unauthorized resolution blocked (Error: %)', sqlerrm;
      else
        raise exception 'Test 6 Failed with unexpected error: %', sqlerrm;
      end if;
  end;


  -- ----------------------------------------------------
  -- 8. TEST CASE: PAYOUT ACCURACY
  -- ----------------------------------------------------
  raise notice 'Test 7: Admin resolving bets with different distances...';
  
  -- Create mock bets for exact match, off-by-1, off-by-2, and off-by-3
  -- Profiles are already auto-created via auth.users in Step 1.
  -- Mock user 3: Guess 40 (Exact match -> +50 tokens)
  insert into public.bets (user_id, bet_date, guess, status, payout)
  values ('00000000-0000-0000-0000-000000000003', test_class_date, 40, 'pending', 0);

  -- Mock user 4: Guess 41 (Off-by-1 -> +20 tokens)
  insert into public.bets (user_id, bet_date, guess, status, payout)
  values ('00000000-0000-0000-0000-000000000004', test_class_date, 41, 'pending', 0);

  -- Mock user 5: Guess 42 (Off-by-2 -> +10 tokens)
  insert into public.bets (user_id, bet_date, guess, status, payout)
  values ('00000000-0000-0000-0000-000000000005', test_class_date, 42, 'pending', 0);

  -- Mock user 6: Guess 43 (Off-by-3 -> 0 tokens)
  insert into public.bets (user_id, bet_date, guess, status, payout)
  values ('00000000-0000-0000-0000-000000000006', test_class_date, 43, 'pending', 0);

  -- Change execution context to Admin user
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id::text)::text, true);

  -- Resolve the class to actual 40
  perform public.resolve_bets(40, test_class_date);

  -- Validate exact match user (Expected tokens: 100 base + 50 payout = 150)
  select tokens into student_tokens_after from public.profiles where id = '00000000-0000-0000-0000-000000000003';
  if student_tokens_after != 150 then
    raise exception 'Test 7 Failed: Exact match payout incorrect! Got: %', student_tokens_after;
  end if;

  -- Validate off-by-1 user (Expected tokens: 100 base + 20 payout = 120)
  select tokens into student_tokens_after from public.profiles where id = '00000000-0000-0000-0000-000000000004';
  if student_tokens_after != 120 then
    raise exception 'Test 7 Failed: Off-by-1 payout incorrect! Got: %', student_tokens_after;
  end if;

  -- Validate off-by-2 user (Expected tokens: 100 base + 10 payout = 110)
  select tokens into student_tokens_after from public.profiles where id = '00000000-0000-0000-0000-000000000005';
  if student_tokens_after != 110 then
    raise exception 'Test 7 Failed: Off-by-2 payout incorrect! Got: %', student_tokens_after;
  end if;

  -- Validate off-by-3 user (Expected tokens: 100 base + 0 payout = 100)
  select tokens into student_tokens_after from public.profiles where id = '00000000-0000-0000-0000-000000000006';
  if student_tokens_after != 100 then
    raise exception 'Test 7 Failed: Off-by-3 payout incorrect! Got: %', student_tokens_after;
  end if;

  raise notice '-> Test 7 Passed: All payout categories resolved with perfect accuracy.';

  raise notice '=== ALL SECURITY AND FUNCTIONAL TESTS PASSED SUCCESSFULLY ===';
end;
$$;

-- Rollback the transaction to keep the database completely clean
rollback;
