import { api, SERVER_URL } from './api';

/* New activity in a household, as it happens — the one live feed the app
   needs, since every shared action writes an activity row.

   The server streams those rows as server-sent events from /live. The
   stream is read with fetch rather than EventSource, because EventSource
   can't send the Authorization header, and a fresh access token is
   picked up on every reconnect.

   `onRow` gets { id, household_id, user_id, text }. Returns an unsubscribe. */
export function subscribeToActivity(householdId, onRow) {
  return streamActivity(householdId, onRow);
}

export function parseEvents(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop();
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue; // keep-alive comment
    try { events.push(JSON.parse(data)); } catch { /* ignore a malformed event */ }
  }
  return { events, rest };
}

function streamActivity(householdId, onRow) {
  let stopped = false;
  let controller = null;
  let retry = 0;

  async function connect() {
    while (!stopped) {
      controller = new AbortController();
      try {
        const { data } = await api.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('not signed in');
        const res = await fetch(`${SERVER_URL}/live?household=${encodeURIComponent(householdId)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store'
        });
        if (!res.ok || !res.body) throw new Error(`live stream ${res.status}`);
        retry = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseEvents(buffer);
          buffer = parsed.rest;
          parsed.events.forEach((row) => { if (!stopped) onRow(row); });
        }
      } catch {
        if (stopped) return;
      }
      // The server closes the stream when the token it was opened with
      // expires; anything else is a dropped connection. Either way, back
      // off a little and reconnect with whatever token is current.
      retry = Math.min(retry + 1, 6);
      await new Promise((r) => setTimeout(r, retry === 1 ? 250 : 1000 * 2 ** (retry - 2)));
    }
  }

  connect();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
