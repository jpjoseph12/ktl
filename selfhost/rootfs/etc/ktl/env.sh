# Sourced by every service. Turns the handful of KTL_* settings into the
# many each internal service expects.
#
# Settings come from two places: the container's own environment, and
# /data/config/settings.env, which the admin page writes. The container wins, so
# a value set on purpose in a template or compose file is never overridden.
set -a
. /data/secrets.env

SETTINGS_KEYS="KTL_SITE_URL KTL_ALLOW_SIGNUP KTL_SMTP_HOST KTL_SMTP_PORT KTL_SMTP_USER KTL_SMTP_PASS KTL_SMTP_SENDER KTL_SMTP_SENDER_NAME CLOUDFLARE_TUNNEL_TOKEN KTL_TRUST_PROXY KTL_BACKUP_HOUR KTL_BACKUP_KEEP KTL_TIMEZONE"
KTL_ENV_KEYS=""
for k in $SETTINGS_KEYS; do
  if [ -n "${!k:-}" ]; then KTL_ENV_KEYS="${KTL_ENV_KEYS:+$KTL_ENV_KEYS,}$k"; fi
done
if [ -f /data/config/settings.env ]; then
  # Lines are KEY='value', with any ' inside written as '"'"'. They're
  # parsed, never run: nothing in the file can execute a command.
  settings_re="^([A-Z][A-Z0-9_]*)='(.*)'$"
  quoted_quote="'\"'\"'"
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ $settings_re ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value//"$quoted_quote"/\'}"
    case " $SETTINGS_KEYS " in *" $key "*) ;; *) continue ;; esac
    if [ -z "${!key:-}" ]; then printf -v "$key" '%s' "$value"; export "$key"; fi
  done < /data/config/settings.env
fi

KTL_PORT="${KTL_PORT:-3000}"
# Until someone gives the server its real address (setup page or
# KTL_SITE_URL), links point at the port it's listening on.
KTL_SITE_URL="${KTL_SITE_URL:-http://localhost:$KTL_PORT}"
KTL_SITE_URL="${KTL_SITE_URL%/}"

# ── GoTrue (accounts) ───────────────────────────────────────────────
API_EXTERNAL_URL="$KTL_SITE_URL/auth/v1"
GOTRUE_API_HOST=127.0.0.1
GOTRUE_SITE_URL="$KTL_SITE_URL"
# Where a reset link may send someone: this site, or into the Android app
# (whose link carries a ?sb_flow_id=… for its one-time code).
GOTRUE_URI_ALLOW_LIST="$KTL_SITE_URL/**,ktl://auth/callback,ktl://auth/callback?**,https://localhost/**"
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${KTL_AUTH_ADMIN_PASSWORD}@127.0.0.1:5432/postgres?search_path=auth&sslmode=disable"
DATABASE_URL="$GOTRUE_DB_DATABASE_URL"
GOTRUE_DB_NAMESPACE=auth
GOTRUE_DB_MIGRATIONS_PATH=/usr/local/etc/auth/migrations
GOTRUE_JWT_SECRET="$KTL_JWT_SECRET"
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
# Every account's sign-in token carries the "authenticated" role, which
# is what row-level security and PostgREST expect. (GoTrue logs a
# deprecation notice for this; without it, accounts made through its admin
# API get an empty role and can't read anything.)
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_EXTERNAL_PHONE_ENABLED=false
GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
# No inbox round trip to sign up: there may be no mail server at all.
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_PASSWORD_MIN_LENGTH=8
GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
GOTRUE_LOG_LEVEL=warn
# Every request reaches GoTrue from the gateway, so rate limits key on the
# client address the gateway passes along, not on 127.0.0.1 for everyone.
GOTRUE_RATE_LIMIT_HEADER=X-Real-IP
GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
GOTRUE_MAILER_SUBJECTS_RECOVERY="Reset your KTL password"
# Whether anyone can create an account is decided by the gateway (from the
# admin page), so it can change without restarting this service.
GOTRUE_DISABLE_SIGNUP=false

# Email is optional — only password resets need it.
if [ -n "${KTL_SMTP_HOST:-}" ]; then
  GOTRUE_SMTP_HOST="$KTL_SMTP_HOST"
  GOTRUE_SMTP_PORT="${KTL_SMTP_PORT:-587}"
  GOTRUE_SMTP_USER="${KTL_SMTP_USER:-}"
  GOTRUE_SMTP_PASS="${KTL_SMTP_PASS:-}"
  GOTRUE_SMTP_ADMIN_EMAIL="${KTL_SMTP_SENDER:-${KTL_SMTP_USER:-}}"
  GOTRUE_SMTP_SENDER_NAME="${KTL_SMTP_SENDER_NAME:-KTL}"
fi

# ── PostgREST (database API) ────────────────────────────────────────
PGRST_DB_URI="postgres://authenticator:${KTL_AUTHENTICATOR_PASSWORD}@127.0.0.1:5432/postgres?sslmode=disable"
PGRST_DB_SCHEMAS=public
PGRST_DB_ANON_ROLE=anon
PGRST_JWT_SECRET="$KTL_JWT_SECRET"
PGRST_SERVER_HOST=127.0.0.1
PGRST_SERVER_PORT=3001
PGRST_ADMIN_SERVER_PORT=3002
PGRST_DB_CHANNEL_ENABLED=true
PGRST_DB_POOL=10
PGRST_LOG_LEVEL=warn
set +a
