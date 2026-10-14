/* Is there a newer KTL? The admin page asks; the server checks the
   project's latest GitHub release at most every six hours. That's the only
   time the server contacts anything outside your network (besides email
   and push, if you set those up), and KTL_UPDATE_CHECK=false turns it off.
   KTL_UPDATE_REPO points it at a fork. */

const SIX_HOURS = 6 * 60 * 60 * 1000;
let cache = { at: 0, value: null };

/* 1.10.0 > 1.9.3. Anything that isn't x.y.z compares as 0.0.0. */
export function compareVersions(a, b) {
  const parse = (v) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')) || [0, 0, 0, 0]).slice(1, 4).map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export async function latestRelease({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  if (String(env.KTL_UPDATE_CHECK || 'true').toLowerCase() === 'false') return null;
  if (cache.value !== null && now - cache.at < SIX_HOURS) return cache.value;
  const repo = env.KTL_UPDATE_REPO || 'jpjoseph12/ktl';
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ktl-server' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(String(res.status));
    const r = await res.json();
    cache = { at: now, value: { version: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url, published: r.published_at } };
  } catch {
    // Offline, rate-limited or blocked: try again later, say nothing now.
    cache = { at: now - SIX_HOURS + 15 * 60 * 1000, value: cache.value };
  }
  return cache.value;
}

/* For the admin page: { current, latest, newer, url } — or null when the
   check is off or hasn't managed to run. */
export async function updateStatus(current, options) {
  const latest = await latestRelease(options);
  if (!latest?.version) return null;
  return { current, latest: latest.version, newer: compareVersions(latest.version, current) > 0, url: latest.url, published: latest.published };
}

export function resetUpdateCache() {
  cache = { at: 0, value: null };
}
