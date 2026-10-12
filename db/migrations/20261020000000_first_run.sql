-- First run.
--
-- Everyone gets a short welcome the first time they open KTL: their name,
-- optionally their own pay and debts, and this device's reminders and lock.
-- profiles.onboarded_at records that they've been through it, so it shows
-- once per person rather than once per device.
--
-- People already using KTL when this arrives have, in effect, been through
-- it: they're marked done so the welcome doesn't interrupt them.

alter table public.profiles add column if not exists onboarded_at timestamptz;

update public.profiles set onboarded_at = now() where onboarded_at is null;
