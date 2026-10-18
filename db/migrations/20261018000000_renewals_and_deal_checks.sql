-- Renewals and deal checks.
--
-- Bills (shared and personal) can carry the date their deal ends and what
-- kind of thing they are, so each phone can remind its owner to look for
-- a better deal in time: energy six weeks ahead (the penalty-free switching
-- window), broadband and mobile four, insurance three, anything else two.
--
-- If whoever runs the server has added an AI provider, anyone can ask it
-- to look for a better deal. A check on a shared bill is kept for the
-- household to see; a check on a personal bill is never stored.

alter table public.bills
  add column if not exists renews_on date,
  add column if not exists renewal_kind text;
alter table public.bills drop constraint if exists bills_renewal_kind_check;
alter table public.bills add constraint bills_renewal_kind_check
  check (renewal_kind is null or renewal_kind in ('energy', 'broadband', 'mobile', 'insurance', 'other'));

alter table public.personal_bills
  add column if not exists renews_on date,
  add column if not exists renewal_kind text;
alter table public.personal_bills drop constraint if exists personal_bills_renewal_kind_check;
alter table public.personal_bills add constraint personal_bills_renewal_kind_check
  check (renewal_kind is null or renewal_kind in ('energy', 'broadband', 'mobile', 'insurance', 'other'));

-- The latest few deal checks per shared bill. Written only by the server
-- (which checks the asker is in the household); readable by the household.
create table if not exists public.deal_checks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  result jsonb not null
);
create index if not exists deal_checks_bill_idx on public.deal_checks (bill_id, checked_at desc);

alter table public.deal_checks enable row level security;
drop policy if exists deal_checks_select on public.deal_checks;
create policy deal_checks_select on public.deal_checks for select to authenticated
  using ((select private.is_household_member(deal_checks.household_id)));

revoke all on public.deal_checks from public, anon, authenticated;
grant select on public.deal_checks to authenticated;
