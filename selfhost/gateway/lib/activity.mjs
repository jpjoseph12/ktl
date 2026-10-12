import pg from 'pg';
import { connectionOptions } from './db.mjs';

/* One LISTEN connection for the whole gateway. Each new activity row
   (see db/selfhost.sql) is handed to every registered handler: the live
   streams of whoever has the household open, and the push sender. */
export function createActivityFeed() {
  const handlers = new Set();
  let client = null;
  let stopped = false;
  let retry = 0;

  async function connect() {
    if (stopped) return;
    client = new pg.Client(connectionOptions({ application_name: 'ktl-activity' }));
    client.on('notification', (msg) => {
      if (msg.channel !== 'ktl_activity' || !msg.payload) return;
      let row;
      try { row = JSON.parse(msg.payload); } catch { return; }
      for (const h of handlers) {
        Promise.resolve().then(() => h(row)).catch((err) => console.error('gateway: activity handler failed', err.message));
      }
    });
    client.on('error', (err) => {
      console.error('gateway: activity listener lost its connection', err.message);
      reconnect();
    });
    try {
      await client.connect();
      await client.query('listen ktl_activity');
      retry = 0;
    } catch (err) {
      console.error('gateway: could not listen for activity', err.message);
      reconnect();
    }
  }

  function reconnect() {
    const old = client;
    client = null;
    old?.end().catch(() => {});
    if (stopped) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * 2 ** retry);
  }

  connect();
  return {
    on(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    stop() { stopped = true; client?.end().catch(() => {}); }
  };
}
