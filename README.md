# KTL

**Shared household bills, with everyone's own finances kept private.**

KTL is for people who share bills. It keeps track of who pays the
provider, each person's share, who has paid, and the running balance
between you. It also gives each person a private space for their own pay,
bills, savings and debts, which nobody else in the household can see.

It's self-hosted: one container on your own server holds all of it. It has
no ads, no tracking and no bank connection, and it never moves money.

**Setting up a server? Start with the guide:
[jpjoseph12.github.io/ktl](https://jpjoseph12.github.io/ktl/)** (the same
page lives in [`docs/`](docs/index.html)).

- **Shared bills.** Rent, energy, broadband and subscriptions: weekly,
  monthly or yearly, split equally, by percentage, or paid by one person.
  For bills that vary, you enter what each one actually came to.
- **Money lent** between two people: a one-off, all or part of it owed back.
- **Settling up.** A running balance with each person, part-payments, and
  "sent / confirmed" or tracking-only modes.
- **Reminders** before bills are due, scheduled on each phone.
- **Live updates.** Everyone sees changes as they happen, plus optional
  push notifications.
- **Yours, which is private to you:**
  - what's left after bills;
  - your own bills;
  - an emergency fund;
  - a debt-payoff planner (snowball or avalanche, 0% offers, a debt-free date);
  - reading a bank export (Monzo CSV and similar) on your device to find
    what you could cut.

  Only your share of the household bills is used here. Nothing in Yours is
  ever shown to anyone else, including whether you use it.
- **Up to six people** per household, on Android, in a browser, and on tablets.

## How it runs

```
            your phone / browser
                    │  https://ktl.example.com
   ┌────────────────┴────────────────────────── one container ───┐
   │  gateway (:3000)   web app, setup & admin pages, live       │
   │                    updates, push, backups                   │
   │     ├── GoTrue      accounts, passwords, sessions           │
   │     ├── PostgREST   the data API, behind row-level security │
   │     └── Postgres    everything, in /data                    │
   │  cloudflared (optional)                                     │
   └─────────────────────────────────────────────────────────────┘
```

Everything that matters is in one folder, `/data`: the database, the
server's generated secrets, settings and nightly backups.

## Quick start

You need Docker. Build the image from this repository:

```bash
docker build -f selfhost/Dockerfile -t ktl:latest .
```

Run it:

```bash
docker run -d --name ktl --restart unless-stopped --stop-timeout 30 \
  -p 8095:3000 -v /path/to/ktl-data:/data ktl:latest
```

Or `docker compose -f selfhost/docker-compose.yml up -d --build`.

On **Unraid**, copy `selfhost/unraid/ktl.xml` to
`/boot/config/plugins/dockerMan/templates-user/my-ktl.xml`. Then use
**Docker → Add Container → Template: ktl**.

Then open **`http://<your-server>:8095/setup`**.

## Setting it up

The setup page asks for:

1. **The setup code**, which the server prints in its log when it starts:

   ```bash
   docker logs ktl 2>&1 | grep "setup code"
   ```

   It stops strangers on your network from claiming the server. Five
   wrong tries lock the page for 15 minutes.
2. **The address people will use.** For use away from home, that's an
   `https://` address from a reverse proxy or a Cloudflare Tunnel (see
   below). For your own network only, `http://<server>:8095` works. You can
   change it later.
3. **Your household's name, and your own account.** You become the
   household's owner, the person who looks after the server.
4. **The people you share with.** Each gets a one-time link: they open it,
   choose a password, and they're in. No email server is needed.
5. **Optional extras:** sign-ups, email, push notifications and a
   Cloudflare Tunnel. They can all be added later.

Everything after that lives on **`/admin`**, linked from **House → Server**
in the app for the owner:
- people (add, send a new sign-in link, remove);
- the address;
- sign-ups;
- email;
- push;
- the tunnel;
- backups.

## The Android app

On first launch the app asks for your server's address, and **House →
Server** shows it afterwards. On a computer or tablet, just open the
address in a browser.

To build the app yourself:

```bash
npm ci
npm run android:debug        # → android/app/build/outputs/apk/debug/app-debug.apk
```

- **Preconfigure the address.** To build the app with your address already
  filled in, put `VITE_SERVER_URL=https://ktl.example.com` in `.env` first.
- **Your own app ID.** If you publish your own build, change the app ID
  (`com.ktl.app`) in `capacitor.config.json` and `android/app/build.gradle`.
- **Release builds.** For a signed release (`npm run android:release`),
  copy `android/keystore.properties.example` to `keystore.properties` and
  point it at your upload key.

### Push notifications (optional)

Without push, KTL still updates live while it's open, and bill reminders
still come from the phone itself. Push tells people's phones when someone
else does something, even with the app closed. It needs your own
[Firebase](https://console.firebase.google.com) project:

1. Add an Android app to the project with your app ID, then download its
   `google-services.json` into `android/app/`. Then build the app as above.
   A build without that file simply doesn't use push.
2. In Firebase, go to **Project settings → Service accounts → Generate new
   private key**. Upload that file on the admin page, under Push
   notifications.

## Reaching it from outside your network

- **Cloudflare Tunnel** needs no open ports:
  1. In Cloudflare Zero Trust, go to **Networks → Tunnels** and create a
     tunnel.
  2. Add a public hostname (e.g. `ktl.example.com`) with service
     `http://localhost:3000`.
  3. Paste the tunnel's token on the admin page, under Cloudflare Tunnel.
  4. Set the address to `https://ktl.example.com`.

  If you already run `cloudflared` elsewhere, point it at
  `http://<server>:8095` instead.
- **Reverse proxy** (Nginx Proxy Manager, SWAG, Caddy, Traefik): proxy
  your hostname to `http://<server>:8095`, with HTTPS. Live updates use
  server-sent events, so turn off response buffering if your proxy
  buffers. If the proxy is on another machine, set `KTL_TRUST_PROXY=true`
  so the server sees real client addresses (it uses them for sign-in rate
  limits).

## Running it

- **Backups:** each night, a consistent copy of everything, accounts
  included, goes into `/data/backups`. The last 14 are kept. They can be
  downloaded from the admin page. That folder is what your own backups
  should keep; copying `/data/postgres` while the server runs isn't a
  reliable backup.
- **Restore:** `docker exec -it ktl ktl-admin restore /data/backups/<file>.dump --yes`.
  It saves the current data first, and runs in a single transaction.
- **Updating:** rebuild the image and recreate the container. Database
  changes apply on start.
- **From a terminal:** `docker exec -it ktl ktl-admin help` covers:
  - `setup-code`, `status` and `users`;
  - `reset-link` and `set-password` (for when there's no email server);
  - `backup`, `restore` and `import-json`.
- **Health:** `/healthz` reports the database, sign-in and data API.

### Settings

Everything is on the setup and admin pages. You can also set any of these
on the container instead, which locks that setting; the admin page shows
it as "set by the container".

| Variable | |
|---|---|
| `KTL_SITE_URL` | The address people open, e.g. `https://ktl.example.com`. |
| `KTL_ALLOW_SIGNUP` | `true` to let anyone who reaches the server create an account. |
| `KTL_SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `_SENDER`, `_SENDER_NAME` | Email, for password resets. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Runs a Cloudflare Tunnel inside the container. |
| `KTL_FCM_SERVICE_ACCOUNT` | A Firebase service-account key (JSON), for push. |
| `KTL_TRUST_PROXY` | `true` behind a reverse proxy on another machine. |
| `KTL_BACKUP_KEEP`, `KTL_BACKUP_HOUR` | Nightly backups to keep (14) and the hour to take them (3). |
| `TZ` | Time zone, used for the backup time. Defaults to `Europe/London`. |

## Development

```bash
npm ci
cp .env.example .env         # set VITE_SERVER_URL to a KTL server to develop against
npm run dev                  # the app, at http://localhost:5173
npm test                     # app tests (Vitest)
cd selfhost/gateway && npm ci && npm test   # server tests
```

- **End-to-end tests** run the Android app against a throwaway server; see
  [`e2e/README.md`](e2e/README.md). The database's own tests are in
  `db/tests` and run against a real server.
- **`src/`** is the app (React + Vite, packaged for Android with Capacitor).
  `src/lib/api.js` is how it reaches the server.
- **`db/migrations/`** is the database schema, applied in order on every
  start. Add a change as a new file; never edit a released one.
- **`selfhost/`** is the container: `Dockerfile`, the gateway (Node, in
  `gateway/`), database bootstrap SQL and the s6 service definitions.

## Credits

KTL stands on [PostgreSQL](https://www.postgresql.org),
[GoTrue](https://github.com/supabase/auth) (MIT) for accounts,
[PostgREST](https://postgrest.org) (MIT) for the data API,
[supabase-js](https://github.com/supabase/supabase-js) (MIT) as the
client for both, [s6-overlay](https://github.com/just-containers/s6-overlay),
[React](https://react.dev), [Vite](https://vite.dev) and
[Capacitor](https://capacitorjs.com).

## License

[AGPL-3.0](LICENSE). You can use, change and self-host KTL freely. If you
run a modified version for other people, share your changes with them.
