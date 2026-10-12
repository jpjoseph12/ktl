/* KTL's front door: the only thing listening outside the container.
 *
 *   /                    the web app, and the /setup and /admin pages
 *   /auth/v1/*           GoTrue — sign up, log in, sessions, password reset
 *   /rest/v1/*           PostgREST — the data, guarded by row-level security
 *   /live                new household activity, as server-sent events
 *   /api/config          what this server is and supports
 *   /api/setup, /api/admin, /api/account   setup, admin and account deletion
 *                        (lib/portal-api.mjs)
 *   /healthz             for Docker, Unraid and uptime checks
 *
 * /auth/v1 and /rest/v1 are the paths GoTrue and PostgREST are usually
 * reached at, which is what the app's client library expects.
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { config, isAllowedOrigin } from './lib/config.mjs';
import { getPool } from './lib/db.mjs';
import { bearer, looksLikeJwt, verifyJwt } from './lib/jwt.mjs';
import { createActivityFeed } from './lib/activity.mjs';
import { createPushSender } from './lib/push.mjs';
import { scheduleBackups } from './lib/backup.mjs';
import { createPortalApi, serverInfo } from './lib/portal-api.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'", // the setup guide shows the app in device frames
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ')
};

/* ── who's asking ─────────────────────────────────────────────────── */

function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/* Cloudflare's tunnel runs inside the container, so its requests come
   from loopback carrying CF-Connecting-IP. Another proxy's
   X-Forwarded-For is only believed when KTL_TRUST_PROXY says so. */
export function clientIp(req) {
  const sock = req.socket.remoteAddress || '';
  if (isLoopback(sock) && req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']);
  if (config.trustProxy || isLoopback(sock)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return sock.replace(/^::ffff:/, '');
}

function forwardedProto(req) {
  const trusted = config.trustProxy || isLoopback(req.socket.remoteAddress);
  return (trusted && req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
}

/* ── CORS: the Android app's WebView (https://localhost) is another origin ── */

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers']
      // The client library sends these on every request.
      || 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-supabase-api-version',
    'Access-Control-Expose-Headers': 'content-range, range, x-total-count, x-supabase-api-version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function sendJson(req, res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req), ...extra });
  res.end(JSON.stringify(body));
}

/* ── GoTrue and PostgREST, behind their usual paths ────────────────── */

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

function proxy(req, res, target, upstreamPath) {
  const url = new URL(target);
  const headers = { ...req.headers };
  HOP_BY_HOP.forEach((h) => delete headers[h]);
  headers.host = url.host;
  const ip = clientIp(req);
  headers['x-real-ip'] = ip;
  headers['x-forwarded-for'] = ip;
  headers['x-forwarded-proto'] = forwardedProto(req);
  headers['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || '';
  // A signed-out client sends its placeholder "API key" as the bearer
  // token. Drop it, so the request is simply anonymous instead of being
  // rejected as a malformed JWT.
  if (headers.authorization && !looksLikeJwt(bearer(req))) delete headers.authorization;

  const upstream = http.request(
    { host: url.hostname, port: url.port, method: req.method, path: upstreamPath, headers },
    (up) => {
      const out = { ...up.headers };
      Object.keys(out).forEach((k) => { if (k.startsWith('access-control-') || HOP_BY_HOP.includes(k)) delete out[k]; });
      res.writeHead(up.statusCode || 502, { ...out, ...corsHeaders(req) });
      up.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) sendJson(req, res, 502, { error: 'service_unavailable', message: 'KTL is still starting up. Try again in a moment.' });
    else res.destroy();
  });
  req.pipe(upstream);
}

/* ── live activity ──────────────────────────────────────────────────── */

async function isMember(householdId, userId) {
  const { rowCount } = await getPool().query(
    'select 1 from public.household_members where household_id = $1 and user_id = $2', [householdId, userId]
  );
  return rowCount > 0;
}

function live(feed) {
  return async (req, res, url) => {
    const claims = verifyJwt(bearer(req), config.jwtSecret);
    if (!claims?.sub) return sendJson(req, res, 401, { error: 'not_signed_in' });
    const householdId = url.searchParams.get('household') || '';
    if (!UUID.test(householdId)) return sendJson(req, res, 400, { error: 'bad_household' });
    if (!(await isMember(householdId, claims.sub))) return sendJson(req, res, 403, { error: 'not_a_member' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(req)
    });
    res.write(': connected\n\n');

    const off = feed.on(async (row) => {
      if (row.household_id !== householdId) return;
      // Membership can end while the stream is open (left, removed).
      if (!(await isMember(householdId, claims.sub))) return close();
      res.write(`data: ${JSON.stringify(row)}\n\n`);
    });
    // Comments every 20s keep Cloudflare and other proxies from timing out.
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    // The stream ends with the token it was opened with; the app reconnects
    // with a fresh one.
    const expiry = setTimeout(close, Math.max(1000, claims.exp * 1000 - Date.now()));
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      off();
      clearInterval(ping);
      clearTimeout(expiry);
      res.end();
    }
    req.on('close', close);
  };
}

/* ── health ───────────────────────────────────────────────────────── */

async function health(req, res) {
  const probe = async (fn) => { try { await fn(); return true; } catch { return false; } };
  const ok = (r) => { if (!r.ok) throw new Error(String(r.status)); };
  const [database, auth, api] = await Promise.all([
    probe(() => getPool().query('select 1')),
    probe(async () => ok(await fetch(`${config.gotrue}/health`, { signal: AbortSignal.timeout(2000) }))),
    probe(async () => ok(await fetch(`${config.postgrestAdmin}/ready`, { signal: AbortSignal.timeout(2000) })))
  ]);
  const healthy = database && auth && api;
  sendJson(req, res, healthy ? 200 : 503, { status: healthy ? 'ok' : 'degraded', database, auth, api });
}

/* ── the web app ──────────────────────────────────────────────────── */

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  const root = path.resolve(config.webRoot);
  let file = path.resolve(root, `.${path.posix.normalize(rel)}`);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(400);
    return res.end();
  }

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  // Client-side routes (/android/home …) are the app's index.html; a
  // missing file with an extension is a real 404.
  if (!info) {
    if (path.extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    file = path.join(root, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) {
      res.writeHead(503);
      return res.end('KTL web app is missing from this image.');
    }
  }

  const ext = path.extname(file).toLowerCase();
  const hashed = rel.startsWith('/assets/') && /-[\w-]{8,}\.\w+$/.test(rel);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/* ── routing ──────────────────────────────────────────────────────── */

const API_PREFIXES = ['/auth/v1', '/rest/v1', '/live', '/api/'];

export function createHandler({ feed, onPushChanged }) {
  const liveHandler = live(feed);
  const portal = createPortalApi({ clientIp, sendJson, onPushChanged });
  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://ktl.local');
    const p = url.pathname;
    try {
      const isApi = API_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
      if (isApi && req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        return res.end();
      }
      if (p === '/healthz') return await health(req, res);
      if (p === '/api/config') return sendJson(req, res, 200, await serverInfo());
      if (p === '/auth/v1' || p.startsWith('/auth/v1/')) {
        const rest = p.slice('/auth/v1'.length) || '/';
        if (rest === '/admin' || rest.startsWith('/admin/')) return sendJson(req, res, 404, { error: 'not_found' });
        // Sign-ups are opened and closed from the admin page; the people the
        // owner adds there are created directly and don't come through here.
        if (rest === '/signup' && req.method === 'POST' && !config.allowSignup) {
          req.resume();
          return sendJson(req, res, 403, { code: 403, error_code: 'signup_disabled', msg: 'New accounts are switched off on this server.' });
        }
        return proxy(req, res, config.gotrue, rest + url.search);
      }
      if (p === '/rest/v1' || p.startsWith('/rest/v1/')) {
        return proxy(req, res, config.postgrest, (p.slice('/rest/v1'.length) || '/') + url.search);
      }
      if (p === '/live') return await liveHandler(req, res, url);
      if (/^\/api\/(setup|admin|account)(\/|$)/.test(p)) return await portal(req, res, p);
      if (p.startsWith('/api/')) return sendJson(req, res, 404, { error: 'not_found' });
      return await serveStatic(req, res, p);
    } catch (err) {
      console.error('gateway: request failed', req.method, p, err);
      if (!res.headersSent) sendJson(req, res, 500, { error: 'internal' });
      else res.destroy();
    }
  };
}

function main() {
  if (!config.jwtSecret) {
    console.error('gateway: KTL_JWT_SECRET is missing');
    process.exit(1);
  }
  const feed = createActivityFeed();
  // Rebuilt whenever the owner uploads or removes a Firebase key.
  let sendPush = createPushSender();
  const onPushChanged = () => { sendPush = createPushSender(); };
  feed.on((row) => {
    if (sendPush) sendPush(row).catch((err) => console.error('gateway: push failed', err.message));
  });
  scheduleBackups();

  const server = http.createServer(createHandler({ feed, onPushChanged }));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`gateway: KTL is listening on :${config.port}, served as ${config.siteUrl}`);
  });

  const stop = () => {
    feed.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
