-- One household per server.
--
-- A KTL server is run for one household, so everyone with an account on it
-- is in that household: the setup page creates it, and each person joins
-- it on their first sign-in (up to six). Household codes, joining by code
-- and creating extra households from the app all go away.

-- Which household is the server's. Set by the setup page; on a server that
-- already has data, it's the household with the most people, then the most
-- bills, then the oldest — and the owner can tidy up any other accounts
-- from the admin page.
insert into ktl_meta.settings (key, value)
select 'household_id', h.id::text
  from public.households h
 order by (select count(*) from public.household_members m where m.household_id = h.id) desc,
          (select count(*) from public.bills b where b.household_id = h.id) desc,
          h.created_at asc
 limit 1
on conflict (key) do nothing;

-- Joining by code used to leave people a member of their old household
-- too. Anyone in the server's household is now only in that one, and a
-- household nobody is left in goes.
delete from public.household_members m
 where m.household_id <> (select value::uuid from ktl_meta.settings where key = 'household_id')
   and m.user_id in (
     select user_id from public.household_members
      where household_id = (select value::uuid from ktl_meta.settings where key = 'household_id')
   );
delete from public.households h
 where not exists (select 1 from public.household_members m where m.household_id = h.id);

create or replace function private.server_household_id()
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $function$
  select nullif(value, '')::uuid from ktl_meta.settings where key = 'household_id';
$function$;

revoke all on function private.server_household_id() from public, anon, authenticated, service_role;

-- Called by the app on every sign-in: makes sure you're in the server's
-- household and says which one it is.
create or replace function public.join_server_household()
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_household_id uuid := private.server_household_id();
  v_member_count int;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if v_household_id is null then
    raise exception 'no_household_yet';
  end if;

  -- Serialise joins so two people signing in at once can't both pass the
  -- size check.
  perform 1 from public.households where id = v_household_id for update;

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
    raise exception 'household_full';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), 'member');

  return v_household_id;
end;
$function$;

revoke all on function public.join_server_household() from public, anon, authenticated, service_role;
grant execute on function public.join_server_household() to authenticated;

-- No more codes, joining by code, or households made from the app.
drop function if exists public.join_household_by_code(text);
drop function if exists public.create_household(text);
alter table public.households alter column code drop not null;
update public.households set code = null;
