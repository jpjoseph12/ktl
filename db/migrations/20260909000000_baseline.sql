-- KTL's schema: tables, keys, indexes, the helpers row-level security
-- calls, functions, triggers, row-level security and grants.
--
-- The API roles (anon, authenticated, service_role) are created by
-- selfhost/db/bootstrap.sql; auth.users belongs to the sign-in service.
-- Push notifications and live updates hang off new activity rows through
-- selfhost/db/selfhost.sql.

-- ── tables ─────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid not null,
  full_name text not null,
  created_at timestamp with time zone default now() not null
);

create table public.households (
  id uuid default gen_random_uuid() not null,
  name text not null,
  code text not null,
  split_you numeric(5,2) default 50 not null,
  split_them numeric(5,2) default 50 not null,
  payout_ref text,
  mode text default 'chase'::text not null,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null
);

create table public.household_members (
  household_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  account_note text,
  joined_at timestamp with time zone default now() not null
);

create table public.household_reminders (
  household_id uuid not null,
  details_lead integer default 5 not null,
  details_time time without time zone default '09:00:00'::time without time zone not null,
  payment_lead integer default 2 not null,
  payment_time time without time zone default '18:00:00'::time without time zone not null,
  nudge_after integer default 24 not null,
  quiet_from time without time zone default '22:00:00'::time without time zone not null,
  quiet_to time without time zone default '08:00:00'::time without time zone not null,
  push boolean default true not null,
  email boolean default false not null,
  weekly_digest boolean default true not null
);

create table public.bills (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  name text not null,
  provider text,
  glyph text default 'card'::text not null,
  logo text,
  logo_w integer,
  logo_h integer,
  total numeric(10,2) not null,
  payer_id uuid not null,
  due_date date,
  due_label text,
  frequency text,
  status text default 'scheduled'::text not null,
  needs_details boolean default false not null,
  details_label text,
  note text,
  sent_note text,
  settled_note text,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null,
  ended_on date,
  frequency_unit text default 'month'::text not null,
  frequency_count integer default 1 not null
);

create table public.bill_shares (
  bill_id uuid not null,
  household_id uuid not null,
  user_id uuid not null,
  share numeric(10,2) not null,
  paid numeric default 0 not null
);

create table public.bill_details (
  bill_id uuid not null,
  household_id uuid not null,
  user_id uuid not null,
  done boolean default false not null,
  value text,
  updated_at timestamp with time zone default now() not null
);

create table public.bill_amounts (
  id uuid default gen_random_uuid() not null,
  bill_id uuid not null,
  household_id uuid not null,
  amount numeric not null,
  for_date date default CURRENT_DATE not null,
  note text,
  recorded_by uuid not null,
  created_at timestamp with time zone default now() not null
);

create table public.lending (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  name text not null,
  glyph text default 'cart'::text not null,
  total numeric(10,2) not null,
  payer_id uuid not null,
  occurred_on date default CURRENT_DATE not null,
  status text default 'payment-due'::text not null,
  note text,
  created_by uuid not null,
  created_at timestamp with time zone default now() not null
);

create table public.lending_shares (
  lending_id uuid not null,
  household_id uuid not null,
  user_id uuid not null,
  share numeric(10,2) not null,
  paid numeric default 0 not null
);

create table public.activity (
  id uuid default gen_random_uuid() not null,
  household_id uuid not null,
  user_id uuid not null,
  text text not null,
  tag text,
  created_at timestamp with time zone default now() not null
);

create table public.device_tokens (
  token text not null,
  user_id uuid not null,
  platform text default 'android'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.private_settings (
  user_id uuid not null,
  debt_module boolean default true not null,
  income numeric(10,2) default 0 not null,
  payday text default '28th'::text not null,
  budget numeric(10,2) default 0 not null,
  strategy text default 'snowball'::text not null,
  updated_at timestamp with time zone default now() not null,
  emergency_saved numeric default 0 not null,
  emergency_months integer default 3 not null
);

create table public.personal_bills (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  kind text default 'Personal'::text not null,
  glyph text default 'card'::text not null,
  amount numeric(10,2) not null,
  day integer not null,
  created_at timestamp with time zone default now() not null
);

create table public.debts (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  kind text default 'Personal'::text not null,
  glyph text default 'card'::text not null,
  balance numeric(10,2) not null,
  apr numeric(5,2) default 0 not null,
  min_payment numeric(10,2) not null,
  promo_months integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  balance_confirmed_at timestamp with time zone default now() not null,
  cleared_at timestamp with time zone
);

create table public.savings_opportunities (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  label text not null,
  detail text,
  amount numeric(10,2) not null,
  shared boolean default false not null,
  applied boolean default false not null,
  created_at timestamp with time zone default now() not null
);

-- ── keys and checks ────────────────────────────────────────────────────

alter table public.activity add constraint activity_pkey PRIMARY KEY (id);
alter table public.bill_amounts add constraint bill_amounts_pkey PRIMARY KEY (id);
alter table public.bill_details add constraint bill_details_pkey PRIMARY KEY (bill_id, user_id);
alter table public.bill_shares add constraint bill_shares_pkey PRIMARY KEY (bill_id, user_id);
alter table public.bills add constraint bills_pkey PRIMARY KEY (id);
alter table public.bills add constraint bills_frequency_count_check CHECK (((frequency_count >= 1) AND (frequency_count <= 52)));
alter table public.bills add constraint bills_frequency_unit_check CHECK ((frequency_unit = ANY (ARRAY['week'::text, 'month'::text, 'year'::text])));
alter table public.bills add constraint bills_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'awaiting-details'::text, 'payment-due'::text, 'sent'::text, 'settled'::text])));
alter table public.debts add constraint debts_pkey PRIMARY KEY (id);
alter table public.device_tokens add constraint device_tokens_pkey PRIMARY KEY (token);
alter table public.household_members add constraint household_members_pkey PRIMARY KEY (household_id, user_id);
alter table public.household_members add constraint household_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])));
alter table public.household_reminders add constraint household_reminders_pkey PRIMARY KEY (household_id);
alter table public.households add constraint households_pkey PRIMARY KEY (id);
alter table public.households add constraint households_code_key UNIQUE (code);
alter table public.households add constraint households_mode_check CHECK ((mode = ANY (ARRAY['chase'::text, 'track'::text])));
alter table public.lending add constraint lending_pkey PRIMARY KEY (id);
alter table public.lending add constraint lending_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'awaiting-details'::text, 'payment-due'::text, 'sent'::text, 'settled'::text])));
alter table public.lending_shares add constraint lending_shares_pkey PRIMARY KEY (lending_id, user_id);
alter table public.personal_bills add constraint personal_bills_pkey PRIMARY KEY (id);
alter table public.personal_bills add constraint personal_bills_day_check CHECK (((day >= 1) AND (day <= 31)));
alter table public.private_settings add constraint private_settings_pkey PRIMARY KEY (user_id);
alter table public.private_settings add constraint private_settings_strategy_check CHECK ((strategy = ANY (ARRAY['snowball'::text, 'avalanche'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.savings_opportunities add constraint savings_opportunities_pkey PRIMARY KEY (id);

alter table public.activity add constraint activity_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.activity add constraint activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.bill_amounts add constraint bill_amounts_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;
alter table public.bill_amounts add constraint bill_amounts_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.bill_amounts add constraint bill_amounts_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);
alter table public.bill_details add constraint bill_details_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;
alter table public.bill_details add constraint bill_details_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.bill_details add constraint bill_details_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.bill_shares add constraint bill_shares_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;
alter table public.bill_shares add constraint bill_shares_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.bill_shares add constraint bill_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.bills add constraint bills_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.bills add constraint bills_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.bills add constraint bills_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES auth.users(id);
alter table public.debts add constraint debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.device_tokens add constraint device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.household_members add constraint household_members_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.household_members add constraint household_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.household_reminders add constraint household_reminders_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.households add constraint households_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.lending add constraint lending_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.lending add constraint lending_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.lending add constraint lending_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES auth.users(id);
alter table public.lending_shares add constraint lending_shares_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;
alter table public.lending_shares add constraint lending_shares_lending_id_fkey FOREIGN KEY (lending_id) REFERENCES public.lending(id) ON DELETE CASCADE;
alter table public.lending_shares add constraint lending_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.personal_bills add constraint personal_bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.private_settings add constraint private_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.savings_opportunities add constraint savings_opportunities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── indexes ────────────────────────────────────────────────────────────

CREATE INDEX activity_household_id_idx ON public.activity USING btree (household_id, created_at DESC);
CREATE INDEX activity_user_id_idx ON public.activity USING btree (user_id);
CREATE INDEX bill_amounts_bill_idx ON public.bill_amounts USING btree (bill_id, for_date DESC);
CREATE INDEX bill_details_household_id_idx ON public.bill_details USING btree (household_id);
CREATE INDEX bill_details_user_id_idx ON public.bill_details USING btree (user_id);
CREATE INDEX bill_shares_household_id_idx ON public.bill_shares USING btree (household_id);
CREATE INDEX bill_shares_user_id_idx ON public.bill_shares USING btree (user_id);
CREATE INDEX bills_created_by_idx ON public.bills USING btree (created_by);
CREATE INDEX bills_household_id_idx ON public.bills USING btree (household_id);
CREATE INDEX bills_payer_id_idx ON public.bills USING btree (payer_id);
CREATE INDEX debts_user_id_idx ON public.debts USING btree (user_id);
CREATE INDEX device_tokens_user_idx ON public.device_tokens USING btree (user_id);
CREATE INDEX household_members_user_id_idx ON public.household_members USING btree (user_id);
CREATE INDEX households_created_by_idx ON public.households USING btree (created_by);
CREATE INDEX lending_created_by_idx ON public.lending USING btree (created_by);
CREATE INDEX lending_household_id_idx ON public.lending USING btree (household_id);
CREATE INDEX lending_payer_id_idx ON public.lending USING btree (payer_id);
CREATE INDEX lending_shares_household_id_idx ON public.lending_shares USING btree (household_id);
CREATE INDEX lending_shares_user_id_idx ON public.lending_shares USING btree (user_id);
CREATE INDEX personal_bills_user_id_idx ON public.personal_bills USING btree (user_id);
CREATE INDEX savings_opportunities_user_id_idx ON public.savings_opportunities USING btree (user_id);

-- ── helpers the row-level security policies call ───────────────────────
-- Kept out of the API's schema so PostgREST never exposes them as RPCs.

create schema if not exists private;

CREATE OR REPLACE FUNCTION private.is_household_member(target_household_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.shares_household_with(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.household_members hm1
    join public.household_members hm2 on hm1.household_id = hm2.household_id
    where hm1.user_id = (select auth.uid())
      and hm2.user_id = target_user_id
  );
$function$;

-- ── functions ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'New user'));

  insert into public.private_settings (user_id) values (new.id);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_household(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_code text;
begin
  loop
    v_code := upper(substr(md5(random()::text), 1, 3)) || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from public.households where code = v_code);
  end loop;

  insert into public.households (name, code, created_by)
  values (p_name, v_code, auth.uid())
  returning id into v_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_id, auth.uid(), 'owner');

  insert into public.household_reminders (household_id) values (v_id);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_household_by_code(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_household_id uuid;
  v_member_count int;
begin
  select id into v_household_id from public.households where code = upper(trim(p_code));
  if v_household_id is null then
    raise exception 'No household found for that code';
  end if;

  -- Lock the household row for the rest of this transaction so two people
  -- racing to join with the same code serialize instead of both passing
  -- the count check before either INSERT commits.
  perform 1 from public.households where id = v_household_id for update;

  -- Already a member: keep the existing idempotent no-op behaviour, and
  -- don't count this as a "new" join against the cap.
  if exists (
    select 1 from public.household_members
    where household_id = v_household_id and user_id = auth.uid()
  ) then
    return v_household_id;
  end if;

  select count(*) into v_member_count
  from public.household_members
  where household_id = v_household_id;

  if v_member_count >= 6 then
    raise exception 'This household already has 6 people, which is the maximum.';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_household_member(p_household_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
  v_open_count int;
  v_next_owner uuid;
begin
  select role into v_caller_role from public.household_members
   where household_id = p_household_id and user_id = v_caller;
  if v_caller_role is null then
    raise exception 'You are not in this household';
  end if;

  select role into v_target_role from public.household_members
   where household_id = p_household_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'That person is not in this household';
  end if;

  -- Only the owner removes other people; anyone may remove themselves.
  if p_user_id <> v_caller and v_caller_role <> 'owner' then
    raise exception 'Only the person who set up this household can remove someone else';
  end if;

  /* Refuse while they still have money in play. The client resolves the
     balance first and shows exactly what is being written off — doing it
     in that order means a half-finished removal can never strand a share
     row that still counts toward a balance nobody can see or settle. */
  select count(*) into v_open_count from (
    select b.id from public.bills b
      where b.household_id = p_household_id
        and b.status in ('scheduled','awaiting-details','payment-due')
        and (b.payer_id = p_user_id
             or exists (select 1 from public.bill_shares s
                         where s.bill_id = b.id and s.user_id = p_user_id and s.share > 0))
    union all
    select l.id from public.lending l
      where l.household_id = p_household_id
        and l.status in ('scheduled','awaiting-details','payment-due')
        and (l.payer_id = p_user_id
             or exists (select 1 from public.lending_shares s
                         where s.lending_id = l.id and s.user_id = p_user_id and s.share > 0))
  ) open_items;

  if v_open_count > 0 then
    raise exception 'Settle or write off their % open item(s) first', v_open_count;
  end if;

  delete from public.household_members
   where household_id = p_household_id and user_id = p_user_id;

  /* An ownerless household could never remove anyone again, so hand
     ownership to whoever has been there longest. */
  if v_target_role = 'owner' then
    select user_id into v_next_owner from public.household_members
     where household_id = p_household_id
     order by joined_at asc limit 1;
    if v_next_owner is not null then
      update public.household_members set role = 'owner'
       where household_id = p_household_id and user_id = v_next_owner;
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hh record;
  v_heir uuid;
begin
  if p_user_id is null then
    raise exception 'No user given';
  end if;

  if exists (
    select 1 from public.household_members m
     where m.user_id = p_user_id
       and exists (select 1 from public.household_members o
                    where o.household_id = m.household_id and o.user_id <> p_user_id)
  ) then
    raise exception 'leave_household_first';
  end if;

  delete from public.households h
   where exists (select 1 from public.household_members m
                  where m.household_id = h.id and m.user_id = p_user_id);

  for v_hh in
    select distinct household_id as id from (
      select id as household_id from public.households where created_by = p_user_id
      union select household_id from public.bills where payer_id = p_user_id or created_by = p_user_id
      union select household_id from public.lending where payer_id = p_user_id or created_by = p_user_id
      union select household_id from public.bill_shares where user_id = p_user_id
      union select household_id from public.lending_shares where user_id = p_user_id
      union select household_id from public.bill_details where user_id = p_user_id
      union select household_id from public.bill_amounts where recorded_by = p_user_id
      union select household_id from public.activity where user_id = p_user_id
    ) refs
  loop
    select user_id into v_heir from public.household_members
     where household_id = v_hh.id
     order by (role = 'owner') desc, joined_at asc
     limit 1;

    if v_heir is null then
      delete from public.households where id = v_hh.id;
      continue;
    end if;

    delete from public.bills where household_id = v_hh.id and payer_id = p_user_id;
    delete from public.lending where household_id = v_hh.id and payer_id = p_user_id;
    delete from public.bill_shares where household_id = v_hh.id and user_id = p_user_id;
    delete from public.lending_shares where household_id = v_hh.id and user_id = p_user_id;
    delete from public.bill_details where household_id = v_hh.id and user_id = p_user_id;
    delete from public.activity where household_id = v_hh.id and user_id = p_user_id;
    update public.bills set created_by = v_heir where household_id = v_hh.id and created_by = p_user_id;
    update public.lending set created_by = v_heir where household_id = v_hh.id and created_by = p_user_id;
    update public.bill_amounts set recorded_by = v_heir where household_id = v_hh.id and recorded_by = p_user_id;
    update public.households set created_by = v_heir where id = v_hh.id and created_by = p_user_id;
  end loop;
end;
$function$;

-- Every new table in public gets row-level security switched on, so a
-- forgotten ALTER can never leave one open to the API.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ── triggers ───────────────────────────────────────────────────────────

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

do $$
begin
  if not exists (select from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
  end if;
end
$$;

-- ── row-level security ─────────────────────────────────────────────────

alter table public.activity enable row level security;
alter table public.bill_amounts enable row level security;
alter table public.bill_details enable row level security;
alter table public.bill_shares enable row level security;
alter table public.bills enable row level security;
alter table public.debts enable row level security;
alter table public.device_tokens enable row level security;
alter table public.household_members enable row level security;
alter table public.household_reminders enable row level security;
alter table public.households enable row level security;
alter table public.lending enable row level security;
alter table public.lending_shares enable row level security;
alter table public.personal_bills enable row level security;
alter table public.private_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.savings_opportunities enable row level security;

-- Household data: visible to and editable by the household's members.
create policy activity_insert on public.activity for insert to authenticated
  with check ((( SELECT private.is_household_member(activity.household_id) AS is_household_member) AND (( SELECT auth.uid() AS uid) = user_id)));
create policy activity_select on public.activity for select to authenticated
  using (( SELECT private.is_household_member(activity.household_id) AS is_household_member));
create policy bill_amounts_delete on public.bill_amounts for delete to authenticated
  using (( SELECT private.is_household_member(bill_amounts.household_id) AS is_household_member));
create policy bill_amounts_insert on public.bill_amounts for insert to authenticated
  with check (( SELECT private.is_household_member(bill_amounts.household_id) AS is_household_member));
create policy bill_amounts_select on public.bill_amounts for select to authenticated
  using (( SELECT private.is_household_member(bill_amounts.household_id) AS is_household_member));
create policy bill_details_select on public.bill_details for select to authenticated
  using (( SELECT private.is_household_member(bill_details.household_id) AS is_household_member));
create policy bill_details_update on public.bill_details for update to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT private.is_household_member(bill_details.household_id) AS is_household_member)))
  with check (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT private.is_household_member(bill_details.household_id) AS is_household_member)));
create policy bill_details_upsert on public.bill_details for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT private.is_household_member(bill_details.household_id) AS is_household_member)));
create policy bill_shares_delete on public.bill_shares for delete to authenticated
  using (( SELECT private.is_household_member(bill_shares.household_id) AS is_household_member));
create policy bill_shares_insert on public.bill_shares for insert to authenticated
  with check (( SELECT private.is_household_member(bill_shares.household_id) AS is_household_member));
create policy bill_shares_select on public.bill_shares for select to authenticated
  using (( SELECT private.is_household_member(bill_shares.household_id) AS is_household_member));
create policy bill_shares_update on public.bill_shares for update to authenticated
  using (( SELECT private.is_household_member(bill_shares.household_id) AS is_household_member))
  with check (( SELECT private.is_household_member(bill_shares.household_id) AS is_household_member));
create policy bills_delete on public.bills for delete to authenticated
  using (( SELECT private.is_household_member(bills.household_id) AS is_household_member));
create policy bills_insert on public.bills for insert to authenticated
  with check (( SELECT private.is_household_member(bills.household_id) AS is_household_member));
create policy bills_select on public.bills for select to authenticated
  using (( SELECT private.is_household_member(bills.household_id) AS is_household_member));
create policy bills_update on public.bills for update to authenticated
  using (( SELECT private.is_household_member(bills.household_id) AS is_household_member))
  with check (( SELECT private.is_household_member(bills.household_id) AS is_household_member));
create policy household_members_select on public.household_members for select to authenticated
  using (( SELECT private.is_household_member(household_members.household_id) AS is_household_member));
create policy household_reminders_select on public.household_reminders for select to authenticated
  using (( SELECT private.is_household_member(household_reminders.household_id) AS is_household_member));
create policy household_reminders_update on public.household_reminders for update to authenticated
  using (( SELECT private.is_household_member(household_reminders.household_id) AS is_household_member))
  with check (( SELECT private.is_household_member(household_reminders.household_id) AS is_household_member));
create policy households_select on public.households for select to authenticated
  using (( SELECT private.is_household_member(households.id) AS is_household_member));
create policy households_update on public.households for update to authenticated
  using (( SELECT private.is_household_member(households.id) AS is_household_member))
  with check (( SELECT private.is_household_member(households.id) AS is_household_member));
create policy lending_delete on public.lending for delete to authenticated
  using (( SELECT private.is_household_member(lending.household_id) AS is_household_member));
create policy lending_insert on public.lending for insert to authenticated
  with check (( SELECT private.is_household_member(lending.household_id) AS is_household_member));
create policy lending_select on public.lending for select to authenticated
  using (( SELECT private.is_household_member(lending.household_id) AS is_household_member));
create policy lending_update on public.lending for update to authenticated
  using (( SELECT private.is_household_member(lending.household_id) AS is_household_member))
  with check (( SELECT private.is_household_member(lending.household_id) AS is_household_member));
create policy lending_shares_delete on public.lending_shares for delete to authenticated
  using (( SELECT private.is_household_member(lending_shares.household_id) AS is_household_member));
create policy lending_shares_insert on public.lending_shares for insert to authenticated
  with check (( SELECT private.is_household_member(lending_shares.household_id) AS is_household_member));
create policy lending_shares_select on public.lending_shares for select to authenticated
  using (( SELECT private.is_household_member(lending_shares.household_id) AS is_household_member));
create policy lending_shares_update on public.lending_shares for update to authenticated
  using (( SELECT private.is_household_member(lending_shares.household_id) AS is_household_member))
  with check (( SELECT private.is_household_member(lending_shares.household_id) AS is_household_member));
create policy profiles_select on public.profiles for select to authenticated
  using (((( SELECT auth.uid() AS uid) = id) OR ( SELECT private.shares_household_with(profiles.id) AS shares_household_with)));
create policy profiles_update_self on public.profiles for update to authenticated
  using ((( SELECT auth.uid() AS uid) = id))
  with check ((( SELECT auth.uid() AS uid) = id));

-- Private data: only ever its owner.
create policy debts_all_delete on public.debts for delete to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy debts_all_insert on public.debts for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy debts_all_select on public.debts for select to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy debts_all_update on public.debts for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy device_tokens_delete_own on public.device_tokens for delete to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy device_tokens_insert_own on public.device_tokens for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy device_tokens_select_own on public.device_tokens for select to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy device_tokens_update_own on public.device_tokens for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy personal_bills_all_delete on public.personal_bills for delete to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy personal_bills_all_insert on public.personal_bills for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy personal_bills_all_select on public.personal_bills for select to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy personal_bills_all_update on public.personal_bills for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy private_settings_select on public.private_settings for select to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy private_settings_update on public.private_settings for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy private_settings_upsert on public.private_settings for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy savings_all_delete on public.savings_opportunities for delete to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy savings_all_insert on public.savings_opportunities for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy savings_all_select on public.savings_opportunities for select to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy savings_all_update on public.savings_opportunities for update to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));

-- ── who can do what through the API ────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated, service_role;

grant select, insert, update, delete on
  public.bills, public.bill_shares, public.lending, public.lending_shares,
  public.device_tokens, public.personal_bills, public.debts, public.savings_opportunities
  to authenticated;
grant select, insert, update on public.bill_details, public.private_settings to authenticated;
grant select, insert, delete on public.bill_amounts to authenticated;
grant select, insert on public.activity to authenticated;
grant select, update on public.profiles, public.households, public.household_reminders to authenticated;
grant select on public.household_members to authenticated;

grant select on public.activity, public.household_members, public.profiles, public.households to service_role;
grant select, delete on public.device_tokens to service_role;

revoke all on function
  public.create_household(text), public.join_household_by_code(text),
  public.remove_household_member(uuid, uuid), public.delete_user_account(uuid),
  public.handle_new_user(), public.rls_auto_enable(),
  private.is_household_member(uuid), private.shares_household_with(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.create_household(text), public.join_household_by_code(text),
  public.remove_household_member(uuid, uuid),
  private.is_household_member(uuid), private.shares_household_with(uuid)
  to authenticated;
-- Only the server may run this one (account deletion).
grant execute on function public.delete_user_account(uuid) to service_role;
