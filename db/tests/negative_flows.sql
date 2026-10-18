-- Database test suite: sign-up, the one-household-per-server rules, and the
-- privacy wall between people in the same household.
--
-- Runs entirely inside one transaction and rolls back at the end, so it
-- never leaves test data behind — safe to run against a real server:
--
--   docker exec -u postgres ktl psql -v ON_ERROR_STOP=1 -f /app/db/tests/negative_flows.sql
--
-- Results are collected into a temp table and SELECTed before the
-- rollback, rather than relying on RAISE NOTICE, so the output shows up in
-- any client.
--
-- IMPORTANT: every impersonation switches to `role authenticated`, not
-- just the JWT claim. `postgres` has BYPASSRLS and, as table owner, ignores
-- GRANTs entirely — a suite that only set the JWT claim while staying on
-- that role would pass even with zero table privileges granted to
-- `authenticated`.
--
-- NOTE: this is fail-fast. Each `do $$ ... $$` block RAISEs an exception
-- on failure, which aborts the whole transaction immediately. If a test
-- fails, the final SELECT never runs — read the error itself, fix the
-- code, then re-run the whole file from the top.

begin;

create temporary table test_state (key text primary key, value text) on commit drop;
create temporary table test_results (seq serial, id text, status text, detail text) on commit drop;
-- Owned by postgres, so once a block below switches to `role
-- authenticated`, that role needs its own grant to keep writing
-- bookkeeping rows into these temp tables.
grant all on test_state, test_results to authenticated;
grant usage, select on test_results_seq_seq to authenticated;

-- Seven fake people standing in for real sign-ups (a household holds six).
insert into auth.users (id, email, raw_user_meta_data, is_sso_user, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'ktl-test-a@ktl.invalid', jsonb_build_object('full_name', 'Test A'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'ktl-test-b@ktl.invalid', jsonb_build_object('full_name', 'Test B'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'ktl-test-c@ktl.invalid', jsonb_build_object('full_name', 'Test C'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'ktl-test-d@ktl.invalid', jsonb_build_object('full_name', 'Test D'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'ktl-test-e@ktl.invalid', jsonb_build_object('full_name', 'Test E'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'ktl-test-f@ktl.invalid', jsonb_build_object('full_name', 'Test F'), false, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'ktl-test-g@ktl.invalid', jsonb_build_object('full_name', 'Test G'), false, now(), now());

-- T0: `authenticated` actually has base table grants — not just RLS
-- policies — on every table the app touches directly (not via a function).
-- RLS policies can be perfectly correct and every table still unreadable
-- through the API if the underlying GRANTs are missing. Checked via
-- information_schema, which needs no role switch.
do $$
declare missing text;
begin
  select string_agg(p.tablename || ':' || p.priv, ', ') into missing
  from (values
    ('profiles','SELECT'), ('households','SELECT'), ('household_members','SELECT'),
    ('household_reminders','SELECT'), ('bills','SELECT'), ('bills','INSERT'),
    ('bill_shares','SELECT'), ('bill_shares','INSERT'), ('bill_details','SELECT'),
    ('lending','SELECT'), ('lending','INSERT'), ('lending_shares','SELECT'),
    ('activity','SELECT'), ('activity','INSERT'),
    ('private_settings','SELECT'), ('personal_bills','SELECT'), ('personal_bills','DELETE'),
    ('debts','SELECT'), ('debts','DELETE'),
    ('savings_opportunities','SELECT'), ('savings_opportunities','DELETE'),
    ('deal_checks','SELECT')
  ) as p(tablename, priv)
  where not exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = p.tablename
      and g.grantee = 'authenticated' and g.privilege_type = p.priv
  );
  if missing is not null then
    raise exception 'FAIL T0: authenticated is missing grants: %', missing;
  end if;
  insert into test_results (id, status, detail) values ('T0', 'PASS', 'authenticated has the base table grants every RLS policy assumes');
end $$;

-- T1: on_auth_user_created fires once per sign-up and creates a profile.
do $$
declare c int;
begin
  select count(*) into c from public.profiles
  where id::text like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa%';
  if c <> 7 then raise exception 'FAIL T1: expected 7 profiles, got %', c; end if;
  insert into test_results (id, status, detail) values ('T1', 'PASS', 'handle_new_user created one profile per sign-up');
end $$;

-- T2: a second account with an already-used email is rejected by the
-- database, so there can never be two accounts for one address.
do $$
begin
  begin
    insert into auth.users (id, email, is_sso_user, created_at, updated_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'ktl-test-a@ktl.invalid', false, now(), now());
    raise exception 'FAIL T2: duplicate email insert should have been rejected';
  exception
    when unique_violation then
      insert into test_results (id, status, detail) values ('T2', 'PASS', 'duplicate email correctly rejected');
  end;
end $$;

-- T3: before setup there is no household to join, and the app is told so.
-- (On a real server the household already exists; set it aside here.)
delete from ktl_meta.settings where key = 'household_id';
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local role authenticated;
do $$
begin
  begin
    perform public.join_server_household();
    raise exception 'FAIL T3: joining before setup should have raised no_household_yet';
  exception
    when others then
      if sqlerrm <> 'no_household_yet' then raise exception 'FAIL T3: wrong error: %', sqlerrm; end if;
      insert into test_results (id, status, detail) values ('T3', 'PASS', 'no household yet is reported as no_household_yet');
  end;
end $$;

-- T4: setup creates the server's household with A as its owner (what the
-- setup page does, as the server itself).
reset role;
do $$
declare hid uuid;
begin
  insert into public.households (name, created_by)
  values ('Test household', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  returning id into hid;
  insert into public.household_members (household_id, user_id, role)
  values (hid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'owner');
  insert into public.household_reminders (household_id) values (hid);
  insert into ktl_meta.settings (key, value) values ('household_id', hid::text);
  insert into test_state values ('hid', hid::text);
  insert into test_results (id, status, detail) values ('T4', 'PASS', 'setup made the server household ' || hid);
end $$;

-- T5: B signs in and is in the household — the same one A owns.
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local role authenticated;
do $$
declare hid uuid; c int;
begin
  select public.join_server_household() into hid;
  if hid::text <> (select value from test_state where key = 'hid') then
    raise exception 'FAIL T5: B joined % instead of the server household', hid;
  end if;
  select count(*) into c from public.household_members where household_id = hid;
  if c <> 2 then raise exception 'FAIL T5: expected 2 members after B joins, got %', c; end if;
  insert into test_results (id, status, detail) values ('T5', 'PASS', 'signing in joins the server household');
end $$;

-- T6: signing in again changes nothing — no duplicate membership.
do $$
declare c int;
begin
  perform public.join_server_household();
  select count(*) into c from public.household_members where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  if c <> 1 then raise exception 'FAIL T6: expected exactly 1 membership for B, got %', c; end if;
  insert into test_results (id, status, detail) values ('T6', 'PASS', 'joining again is idempotent');
end $$;

-- T7: the household takes six people, and the seventh is told it's full.
reset role;
insert into public.household_members (household_id, user_id, role)
select (select value from test_state where key = 'hid')::uuid, u, 'member'
  from unnest(array[
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
  ]::uuid[]) as u;
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
set local role authenticated;
do $$
begin
  begin
    perform public.join_server_household();
    raise exception 'FAIL T7: a seventh person should have been refused';
  exception
    when others then
      if sqlerrm <> 'household_full' then raise exception 'FAIL T7: wrong error: %', sqlerrm; end if;
      insert into test_results (id, status, detail) values ('T7', 'PASS', 'a seventh person is refused with household_full');
  end;
end $$;

-- T8: the privacy wall — B can't see A's debts, even in the same household.
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
set local role authenticated;
insert into public.debts (user_id, name, balance, min_payment)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Test card', 100, 10);
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local role authenticated;
do $$
declare c int;
begin
  select count(*) into c from public.debts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if c <> 0 then raise exception 'FAIL T8: B can see % of A''s debts', c; end if;
  insert into test_results (id, status, detail) values ('T8', 'PASS', 'another member can''t see your debts');
end $$;

-- T9: account deletion can only be run by the server, never from the app.
do $$
begin
  begin
    perform public.delete_user_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    raise exception 'FAIL T9: the app was able to call delete_user_account';
  exception
    when insufficient_privilege then
      insert into test_results (id, status, detail) values ('T9', 'PASS', 'delete_user_account is server-only');
  end;
end $$;

-- T10: the old household-code functions are gone.
reset role;
do $$
begin
  if to_regprocedure('public.join_household_by_code(text)') is not null
     or to_regprocedure('public.create_household(text)') is not null then
    raise exception 'FAIL T10: household-code functions still exist';
  end if;
  insert into test_results (id, status, detail) values ('T10', 'PASS', 'no join-by-code or create-household functions remain');
end $$;

-- T11: the first-run welcome. A new account hasn't been through it; you
-- can mark yourself done, but not someone else.
do $$
declare done_at timestamptz;
begin
  select onboarded_at into done_at from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  if done_at is not null then raise exception 'FAIL T11: a new account starts as already welcomed'; end if;
end $$;
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local role authenticated;
update public.profiles set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
update public.profiles set onboarded_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
reset role;
do $$
declare mine timestamptz; theirs timestamptz;
begin
  select onboarded_at into mine from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  select onboarded_at into theirs from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  if mine is null then raise exception 'FAIL T11: B couldn''t mark their own welcome done'; end if;
  if theirs is not null then raise exception 'FAIL T11: B marked A''s welcome done'; end if;
  insert into test_results (id, status, detail) values ('T11', 'PASS', 'you can finish your own welcome, not someone else''s');
end $$;

-- T12: invites are the server's alone — the app can't read or write them.
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local role authenticated;
do $$
begin
  begin
    perform 1 from ktl_meta.invites limit 1;
    raise exception 'FAIL T12: the app can read invites';
  exception
    when insufficient_privilege then
      insert into test_results (id, status, detail) values ('T12', 'PASS', 'invites are hidden from the app');
  end;
end $$;
reset role;

-- T13: deal checks are written by the server only; members read their
-- household's, and someone outside it reads none. A bill's renewal kind
-- only takes the known values.
do $$$$
declare bill uuid; hid uuid;
begin
  select household_id into hid from public.household_members where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  insert into public.bills (household_id, name, glyph, total, payer_id, due_date, status, created_by, renews_on, renewal_kind)
  values (hid, 'Test energy', 'bolt', 90, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date + 10, 'scheduled', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', current_date + 40, 'energy')
  returning id into bill;
  insert into public.deal_checks (household_id, bill_id, checked_by, provider, model, result)
  values (hid, bill, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'anthropic', 'test', '{"summary":"ok"}');
  insert into test_state (key, value) values ('deal_bill', bill::text);
  begin
    update public.bills set renewal_kind = 'gym' where id = bill;
    raise exception 'FAIL T13: a renewal kind outside the list was accepted';
  exception
    when check_violation then null;
  end;
end $$$$;
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
set local role authenticated;
do $$$$
declare c int; bill uuid;
begin
  select value::uuid into bill from test_state where key = 'deal_bill';
  select count(*) into c from public.deal_checks where bill_id = bill;
  if c <> 1 then raise exception 'FAIL T13: a member sees % deal checks, expected 1', c; end if;
  begin
    insert into public.deal_checks (household_id, bill_id, checked_by, provider, model, result)
    select household_id, bill, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'x', 'x', '{}' from public.bills where id = bill;
    raise exception 'FAIL T13: the app could write a deal check';
  exception
    when insufficient_privilege then null;
  end;
end $$$$;
set local "request.jwt.claim.sub" to 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
set local role authenticated;
do $$$$
declare c int;
begin
  select count(*) into c from public.deal_checks;
  if c <> 0 then raise exception 'FAIL T13: someone outside the household sees % deal checks', c; end if;
  insert into test_results (id, status, detail) values ('T13', 'PASS', 'deal checks are server-written and household-only');
end $$$$;
reset role;

select id, status, detail from test_results order by seq;

rollback;
