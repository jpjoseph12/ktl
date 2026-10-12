import * as settings from './settings.mjs';

/* Everything the gateway reads from its environment, in one place.
   /etc/ktl/env.sh has already filled in the defaults and the generated
   secrets by the time any of this runs.

   Fixed for the life of the process: ports, secrets, paths. Read live
   from the settings the admin page saves (lib/settings.mjs): the server's
   address, whether sign-ups are open, whether email is set up. */
const env = process.env;

export const config = {
  port: Number(env.KTL_PORT || 3000),
  jwtSecret: env.KTL_JWT_SECRET || '',
  setupCode: env.KTL_SETUP_CODE || '',
  // Behind another reverse proxy on the LAN (Nginx Proxy Manager, SWAG…),
  // trust its X-Forwarded-For. Cloudflare's tunnel is trusted regardless,
  // since it connects from inside the container.
  trustProxy: (env.KTL_TRUST_PROXY || 'false') === 'true',
  // Other origins allowed to call the API: the Android app's WebView is
  // https://localhost; add more, comma-separated, if ever needed.
  extraOrigins: (env.KTL_EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  gotrue: 'http://127.0.0.1:9999',
  postgrest: 'http://127.0.0.1:3001',
  postgrestAdmin: 'http://127.0.0.1:3002',
  webRoot: env.KTL_WEB_ROOT || '/app/web',
  backupDir: env.KTL_BACKUP_DIR || '/data/backups',
  backupKeep: Number(env.KTL_BACKUP_KEEP || 14),
  backupHour: Number(env.KTL_BACKUP_HOUR || 3),
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
  }
};

export function isAllowedOrigin(origin) {
  return [config.siteOrigin, 'https://localhost', 'http://localhost', 'capacitor://localhost', ...config.extraOrigins]
    .includes(origin);
}
