-- Live updates and push notifications. Re-applied on every boot.
--
-- Every shared action writes an activity row, so one NOTIFY per new row
-- is all it takes: the gateway listens, streams the row to the household's
-- open apps (/live) and sends the push (if the server has a Firebase key).
create or replace function ktl_meta.notify_activity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_notify('ktl_activity', json_build_object(
    'id', new.id,
    'household_id', new.household_id,
    'user_id', new.user_id,
    'text', left(new.text, 2000)
  )::text);
  return new;
end
$$;
revoke all on function ktl_meta.notify_activity() from public;

drop trigger if exists ktl_activity_notify on public.activity;
create trigger ktl_activity_notify
  after insert on public.activity
  for each row execute function ktl_meta.notify_activity();
