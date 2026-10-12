-- Invites.
--
-- When the owner adds someone, the admin page hands them a message to
-- send: a link that opens KTL, fills in this server's address and lets the
-- person choose their password. Each invite works once and expires, so a
-- forwarded or old link is no use to anyone else.
--
-- Only a hash of each invite's token is kept. Making a new invite for
-- someone cancels the one before. ktl_meta isn't visible to the app's
-- roles at all: only the server (the gateway) reads and writes this.

create table if not exists ktl_meta.invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invites_user_id_idx on ktl_meta.invites (user_id);

revoke all on ktl_meta.invites from public;
