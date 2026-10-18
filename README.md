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

You need Docker. Run the published image (for amd64 and arm64):

```bash
docker run -d --name ktl --restart unless-stopped --stop-timeout 30 \
  -p 8095:3000 -v /path/to/ktl-data:/data ghcr.io/jpjoseph12/ktl:latest
```

Or `docker compose -f selfhost/docker-compose.yml up -d`.

On **Unraid**, use **Docker → Add Container** with Repository
`ghcr.io/jpjoseph12/ktl:latest`, port 3000 and a path for `/data` — or
copy `selfhost/unraid/ktl.xml` to
`/boot/config/plugins/dockerMan/templates-user/my-ktl.xml` and choose
**Template: ktl**. Unraid's "check for updates" then picks up new
releases.

To build the image yourself instead:
`docker build -f selfhost/Dockerfile -t ktl:latest .`

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

**Download it** from [the latest release](https://github.com/jpjoseph12/ktl/releases/latest)
(`ktl-<version>.apk`). Check it against the `.sha256` file beside it if
you like. On first launch the app asks for your server's address — or open
an invite from whoever runs your server, which fills it in — and **House →
Server** shows it afterwards. The downloadable app is built with the
maintainer's Firebase project, so it gets push from servers that hold that
project's key; other servers simply don't send push (see below). On a
computer or tablet, just open the address in a browser.

To build the app yourself:

```bash
npm ci
npm run android:debug        # → android/app/build/outputs/apk/debug/app-debug.apk
```

- **Preconfigure the address.** To build the app with your address already
  filled in, put `VITE_SERVER_URL=https://ktl.example.com` in `.env` first.
- **Your own app ID.** If you publish your own build, change the app ID
  (`com.ktl.app`) in `capacitor.config.json` and `android/app/build.gradle`.
- **Release builds.** Copy `android/keystore.properties.example` to
  `keystore.properties` and point it at your key, then
  `npm run android:apk` (a signed APK in `release/`) or
  `npm run android:release` (an app bundle for Play). A release build
  without a key stops rather than producing an unsigned one.

### Push notifications (optional)

Without push, KTL still updates live while it's open, and bill reminders
still come from the phone itself. Push tells people's phones when someone
else does something, even with the app closed. Firebase Cloud Messaging is
free.

Push needs the app and the server to share a
[Firebase](https://console.firebase.google.com) project: the app is built
with the project's `google-services.json` (its app config — not a
secret, it's inside every APK), and the server holds the project's
**service-account key** (a secret — it never leaves your server). The app
only asks for notification permission when its server says push is set up.

To use push with your own server:

1. In your Firebase project, add an Android app with your app ID and
   download its `google-services.json` into `android/app/`. Build the app
   as above (or, for releases, `node scripts/set-release-secrets.mjs` adds
   it as the `GOOGLE_SERVICES_JSON` secret). A build without it has no push.
2. In Firebase, go to **Project settings → Service accounts → Generate new
   private key**, and upload that file on the admin page under Push
   notifications.
3. In Google Cloud Console → **APIs & Services → Credentials**, restrict the
   project's API key to Android apps with your app ID and release-key
   fingerprint, and to the Firebase Cloud Messaging and Firebase
   Installations APIs, and leave the project's other Firebase products off.

### Renewals and AI deal search (optional)

Any bill, shared or your own, can have the date its deal ends. Each phone
reminds its owner in time to look around: energy six weeks before (when
you can usually switch without exit fees), broadband and mobile four,
insurance three, anything else two.

If you add an AI provider on the admin page (**AI deal search**: Claude,
OpenAI or Gemini, with your own API key), anyone in the household can tap
**Check for a better deal** and the AI searches the web for current
offers. Each search is billed to your key — usually pennies, more with the
biggest models — and everyone gets 10 a day. The AI is told only the kind
of bill, the provider, the cost, the end date and a postcode area if the
person types one. Results for shared bills are kept (the latest five) for
the household; results for personal bills are shown once and never
stored.

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
| `KTL_AI_PROVIDER`, `KTL_AI_API_KEY`, `KTL_AI_MODEL` | AI deal search: `anthropic`, `openai` or `gemini`, your API key, and optionally a model. |
| `KTL_TRUST_PROXY` | `true` behind a reverse proxy on another machine. |
| `KTL_BACKUP_KEEP`, `KTL_BACKUP_HOUR` | Nightly backups to keep (14) and the hour to take them (3). |
| `TZ` | Time zone, used for the backup time. Defaults to `Europe/London`. |
| `KTL_UPDATE_CHECK` | `false` stops the server checking GitHub for a newer KTL (shown on the admin page). It's the only outside call the server makes on its own. |

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

## Releasing

For maintainers. **Every release ships a signed APK, signed with the
same release key every time** — otherwise phones can't update from one
version to the next. This is enforced, not just expected. A version tag
runs `release.yml`, which:

1. builds the public APK and checks its signature against KTL's release
   key, whose certificate fingerprint is pinned in
   `android/release-cert.sha256`. An unsigned APK, or one signed with any
   other key, stops the release;
2. only then publishes the server image (`image.yml`);
3. puts the APK and its SHA-256 on a draft GitHub release, which you look
   over and publish.

`npm run android:apk` runs the same check locally.

```bash
npm version minor            # 1.0.0 → 1.1.0: package.json, a commit and the v1.1.0 tag
git push && git push --tags
```

The APK workflow needs the release key as four repository secrets. With
the key at `../ktl-release-key.jks` and its passwords in
`android/keystore.properties`, add them with the GitHub CLI from the
repository folder, in any terminal. It reads the secrets from your files
and hands them to `gh` directly, so nothing is typed or shown on screen.
Replace `OWNER/ktl` with your repository:

```bash
node scripts/set-release-secrets.mjs OWNER/ktl
```

Keep the key and `keystore.properties` backed up together: every update
has to be signed with the same key.

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
