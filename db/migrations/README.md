# Migrations

KTL's database schema, in order. The server applies any it hasn't run yet
every time it starts, and records them in `ktl_meta.schema_migrations`.

Add a change as a new file named `<yyyymmddhhmmss>_<what_it_does>.sql`.
Never edit one that has been released: servers that already ran it won't
run it again.
