import * as settings from './settings.mjs';

/* Everything the gateway reads from its environment, in one place.
   /etc/ktl/env.sh has already filled in the defaults and the generated
   secrets by the time any of this runs.

   Fixed for the life of the process: ports, secrets, paths. Read live
   from the settings the admin page saves (lib/settings.mjs): the server's
   address, whether sign-ups are open, whether email is set up, the
   reverse proxy, and the backup schedule. */
const env = process.env;

export const config = {
  port: Number(env.KTL_PORT || 3000),
  jwtSecret: env.KTL_JWT_SECRET || '',
  setupCode: env.KTL_SETUP_CODE || '',
  // Other origins allowed to call the API: the Android app's WebView is
  // https://localhost; add more, comma-separated, if ever needed.
  extraOrigins: (env.KTL_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  gotrue: 'http://127.0.0.1:9999',
  postgrest: 'http://127.0.0.1:3001',
  postgrestAdmin: 'http://127.0.0.1:3002',
  webRoot: env.KTL_WEB_ROOT || '/app/web',
  backupDir: env.KTL_BACKUP_DIR || '/data/backups',
  fcmServiceAccountFile: env.KTL_FCM_SERVICE_ACCOUNT_FILE || '/data/push/fcm-service-account.json',

  /* The address people open, e.g. https://ktl.example.com. Until it's
     set, links point at the port the server listens on. */
  get siteUrl() {
    return (settings.get('KTL_SITE_URL') || `http://localhost:${this.port}`).replace(/\/+$/, '');
  },
  get siteOrigin() {
    try { return new URL(this.siteUrl).origin; } catch { return ''; }
  },
  /* Closed unless someone opened them: the setup page creates accounts for
     the household, so nobody else needs to be able to sign up. */
  get allowSignup() {
    return settings.get('KTL_ALLOW_SIGNUP') === 'true';
  },
  get emailEnabled() {
    return Boolean(settings.get('KTL_SMTP_HOST'));
  },
  /* Behind another reverse proxy on the LAN (Nginx Proxy Manager, SWAG…),
     trust its X-Forwarded-For. Cloudflare's tunnel is trusted regardless,
     since it connects from inside the container. */
  get trustProxy() {
    return settings.get('KTL_TRUST_PROXY') === 'true';
  },
  /* Nightly backups: how many to keep (0 = off) and the hour, in the
     server's time zone, to take them. */
  get backupKeep() {
    const n = Number(settings.get('KTL_BACKUP_KEEP') || 14);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 14;
  },
  get backupHour() {
    const n = Number(settings.get('KTL_BACKUP_HOUR') || 3);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 3;
  },
  /* AI deal checks: on once a provider and its key are set. */
  get aiProvider() {
    return settings.get('KTL_AI_PROVIDER');
  },
  get aiEnabled() {
    return Boolean(settings.get('KTL_AI_PROVIDER') && settings.get('KTL_AI_API_KEY'));
  },
  get timezone() {
    const tz = settings.get('KTL_TIMEZONE') || env.TZ || 'Europe/London';
    return validTimezone(tz) ? tz : 'Europe/London';
  }
};

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin) {
  return [config.siteOrigin, 'https://localhost', 'http://localhost', 'capacitor://localhost', ...config.extraOrigins]
    .includes(origin);
}
