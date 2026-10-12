import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import '../styles/setup-guide.css';

/* /setup on a computer: the whole self-hosting guide on one page, with the
   real setup form in step 3 and the real app running in three device
   frames. Phones get the step-by-step wizard in Setup.jsx instead. */

const NEED = [
  ['settings', 'The setup code', <>It’s in the server’s log. Run <code>docker logs ktl</code>, or open the container’s log in Unraid or Portainer, and look for “setup code”. It stops strangers on your network from claiming the server.</>],
  ['signal', 'The address people will use', <>For use away from home, put KTL behind a reverse proxy or a Cloudflare Tunnel and use that <code>https://</code> address. For your own network only, <code>http://&lt;server&gt;:8095</code> works.</>],
  ['users', 'Who you share with', <>Names and email addresses, up to six people including you. Each gets their own private space for pay and debts, and one-time sign-in links.</>],
  ['bell', 'Optional extras', <>An email server so people can reset passwords themselves, a Firebase project for push notifications, and a Cloudflare Tunnel token. All can be added later from the admin page.</>]
];

const DEPLOY = `docker build -f selfhost/Dockerfile -t ktl:latest .
docker run -d --name ktl --restart unless-stopped --stop-timeout 30 \\
  -p 8095:3000 -v /path/to/ktl-data:/data ktl:latest`;

export const SCREENS = [
  { id: 'home', label: 'Home' },
  { id: 'bills', label: 'Bills' },
  { id: 'settle', label: 'Balance' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'yours', label: 'Yours' },
  { id: 'household', label: 'House' }
];

const SETTINGS = [
  ['KTL_SITE_URL', 'The address people open, e.g. https://ktl.example.com.'],
  ['KTL_ALLOW_SIGNUP', 'true to let anyone who reaches the server create an account.'],
  ['KTL_SMTP_HOST, _PORT, _USER, _PASS, _SENDER, _SENDER_NAME', 'Email, for password resets.'],
  ['CLOUDFLARE_TUNNEL_TOKEN', 'Runs a Cloudflare Tunnel inside the container.'],
  ['KTL_FCM_SERVICE_ACCOUNT', 'A Firebase service-account key (JSON), for push.'],
  ['KTL_TRUST_PROXY', 'true behind a reverse proxy on another machine.'],
  ['KTL_BACKUP_KEEP, KTL_BACKUP_HOUR', 'Nightly backups to keep (14) and the hour to take them (3).'],
  ['TZ', 'Time zone for the backup time. Defaults to Europe/London.']
];

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    try { navigator.clipboard?.writeText(children); } catch { /* not allowed here */ }
    setCopied(true);
  };
  return (
    <div className="code-wrap">
      <pre className="code">{children}</pre>
      <button className="code-copy" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/* A device frame drawn at its real size and scaled to fit its column. */
function Frame({ kind, width, height, children }) {
  const viewport = useRef(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div className="frame-viewport" ref={viewport} style={{ height: height * scale }}>
      <div className={`frame-inner ${kind}`} style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

function Gallery() {
  const [screen, setScreen] = useState('home');
  const src = `/android/${screen}`;
  const host = typeof window !== 'undefined' ? window.location.host : '';
  return (
    <section className="section" id="devices">
      <div className="container">
        <div className="gallery-head">
          <div className="head-lg" style={{ marginBottom: 0 }}>
            <p className="eyebrow">The same household, three canvases</p>
            <h2>How it works on mobile, tablet and desktop.</h2>
            <p>Each frame below runs the real app from this server — pick a screen and they all change. Once you’re logged in they show your own household, and a change made in one frame shows up in the others as it happens.</p>
          </div>
          <div className="gallery-controls">
            <div className="seg" role="tablist" aria-label="Screen">
              {SCREENS.map((s) => (
                <button key={s.id} role="tab" type="button" aria-selected={screen === s.id} onClick={() => setScreen(s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="gallery">
          <figure className="frame phone">
            <Frame kind="phone" width={460} height={948}>
              <iframe src={src} title="KTL on an Android phone" loading="lazy" />
            </Frame>
            <figcaption className="frame-caption"><h3>Mobile</h3><span className="meta">Android</span></figcaption>
            <p className="frame-note">One column, a bottom bar, a badged bell for the reminder queue, and a private Yours tab. Up to six people share the household; the phone is where the reminders land.</p>
          </figure>

          <figure className="frame tablet">
            <Frame kind="tablet" width={1218} height={858}>
              <iframe src={src} title="KTL on an Android tablet" loading="lazy" />
            </Frame>
            <figcaption className="frame-caption"><h3>Tablet</h3><span className="meta">Android tablet</span></figcaption>
            <p className="frame-note">The same fundamentals on a bigger canvas: a persistent sidebar, a list pane and a detail pane that updates as you select. The one-time onboarding and splash stay a single centred column, since a linear flow has nothing to put in a second pane.</p>
          </figure>

          <figure className="frame desktop">
            <Frame kind="browser" width={1194} height={900}>
              <div className="browser-bar">
                <span className="browser-dots" aria-hidden="true"><span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" /></span>
                <span className="browser-url">{host}</span>
              </div>
              <iframe src={src} title="KTL in a desktop browser" loading="lazy" />
            </Frame>
            <figcaption className="frame-caption"><h3>Desktop</h3><span className="meta">Browser</span></figcaption>
            <p className="frame-note">On a computer, just open the address in a browser. The app uses the same wide master-detail layout as tablets, while setup and admin run as a centred single column. Nothing to install.</p>
          </figure>
        </div>
      </div>
    </section>
  );
}

/* `claim` is what step 3 shows: the live setup form, or — once the server
   is set up — where to go next. */
export default function SetupGuide({ ready, claim }) {
  return (
    <div className="setup-guide">
      <header className="topnav">
        <div className="container topnav-inner">
          <Link className="logo" to="/android/onboarding">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9h10a4 4 0 0 1 4 4v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a2 2 0 0 1 2-2z" />
              <path d="M16 9V6.5a2.5 2.5 0 0 0-5 0" /><path d="M8 3.5c.8.9.8 1.6 0 2.5" />
            </svg>
            KTL
          </Link>
          <nav aria-label="Sections">
            <a href="#need">What you need</a>
            <a href="#setup">Set up</a>
            <a href="#works">How it works</a>
            <a href="#devices">Across devices</a>
            <a href="#reach">From outside</a>
            <a href="#running">Running it</a>
          </nav>
          <Link className="open-link" to="/android/onboarding">Open KTL ↗</Link>
        </div>
      </header>

      <main>
        <section className="section">
          <div className="container">
            <div className="hero">
              <p className="eyebrow">Self-hosted · Android, browser and tablet</p>
              <h1>Run KTL on your own server.</h1>
              <p className="lead">KTL keeps shared household bills and each person’s own finances private — one container, no ads, no tracking, no bank connection, and it never moves money. This page sets your server up, then shows how the same household works on mobile, tablet and desktop.</p>
              <div className="hero-cta">
                {ready
                  ? <Link className="btn btn-primary" to="/android/onboarding">Log in to KTL</Link>
                  : <a className="btn btn-primary" href="#setup">Start the setup</a>}
                <a className="btn btn-secondary" href="#works">See how it works</a>
                {ready && <Link className="btn btn-ghost" to="/admin">People and server settings →</Link>}
              </div>
            </div>

            <dl className="facts">
              <div className="fact"><dt>Everything in</dt><dd>One container</dd></div>
              <div className="fact"><dt>Household size</dt><dd>Up to six people</dd></div>
              <div className="fact"><dt>Backups</dt><dd>Nightly, 14 kept</dd></div>
              <div className="fact"><dt>Licence</dt><dd>AGPL-3.0</dd></div>
            </dl>
          </div>
        </section>

        <section className="section" id="need">
          <div className="container">
            <div className="head-lg">
              <p className="eyebrow">Before you start</p>
              <h2>What you’ll need</h2>
              <p>Setup takes a couple of minutes. Two things are required — the setup code and an address — and everything else can wait until later.</p>
            </div>
            <div className="grid-2">
              {NEED.map(([icon, title, body]) => (
                <div className="card card-lg need" key={title}>
                  <span className="glyph on-warm"><Icon name={icon} size={18} /></span>
                  <div>
                    <p className="item-title">{title}</p>
                    <p className="item-sub">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="setup">
          <div className="container">
            <div className="head-lg">
              <p className="eyebrow">The setup</p>
              <h2>From <code>docker run</code> to a working household</h2>
              <p>The first run happens in the browser. Steps 3 to 5 are the same cards as the admin page, so anything you skip here can be done there later.</p>
            </div>

            <div className="steps">
              <div className="step">
                <span className="step-num">1</span>
                <div className="step-body">
                  <h3>Deploy the container</h3>
                  <p>You need Docker. Build the image from the repository, then run it with a folder mounted at <code>/data</code> for the database, secrets, settings and backups.</p>
                  <CodeBlock>{DEPLOY}</CodeBlock>
                  <p>Or use Compose — <code>docker compose -f selfhost/docker-compose.yml up -d --build</code>. On <strong>Unraid</strong>, copy <code>selfhost/unraid/ktl.xml</code> to <code>/boot/config/plugins/dockerMan/templates-user/my-ktl.xml</code>, then use <strong>Docker → Add Container → Template: ktl</strong>.</p>
                </div>
              </div>

              <div className="step">
                <span className="step-num">2</span>
                <div className="step-body">
                  <h3>Read the setup code</h3>
                  <p>The server prints a code to its log when it starts. Five wrong tries at the setup page locks it for 15 minutes.</p>
                  <CodeBlock>{'docker logs ktl 2>&1 | grep "setup code"'}</CodeBlock>
                </div>
              </div>

              <div className="step">
                <span className="step-num">3</span>
                <div className="step-body">
                  <h3>Open the setup page and claim the server</h3>
                  <p>You’re on it. One step creates the household and your own account at the same time, so a half-set-up server can’t exist: the setup code, the address, your household name, and your name, email and password. You become the household’s owner — the person who looks after the server.</p>
                  <div className="portal">{claim}</div>
                </div>
              </div>

              <div className="step">
                <span className="step-num">4</span>
                <div className="step-body">
                  <h3>Add the people you share with</h3>
                  <p>Each person gets a one-time link: they open it, choose a password, and they’re in. No email server is needed for this. You can add or remove people later from <strong>House → Server</strong>.</p>
                </div>
              </div>

              <div className="step">
                <span className="step-num">5</span>
                <div className="step-body">
                  <h3>Optional extras</h3>
                  <p>Turn on sign-ups, add an email server, set up push notifications, or paste a Cloudflare Tunnel token. Skip any of these — they’re all on the admin page later.</p>
                </div>
              </div>

              <div className="step">
                <span className="step-num">6</span>
                <div className="step-body">
                  <h3>Give people the address</h3>
                  <p>On the Android app, the first launch asks for your server’s address; afterwards <strong>House → Server</strong> shows it. On a computer or tablet, just open the address in a browser. Everything after setup lives on <code>/admin</code>, linked from <strong>House → Server</strong> for the owner.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="works">
          <div className="container">
            <div className="head-lg">
              <p className="eyebrow">What the household gets</p>
              <h2>Shared bills, private money, one honest balance.</h2>
              <p>The household is jointly visible by design, and everything about your own money sits behind a boundary the shared side cannot read through.</p>
            </div>

            <div className="split">
              <article className="card card-lg stack">
                <div className="row-between">
                  <h3>The household</h3>
                  <span className="pill is-scheduled">Both of you</span>
                </div>
                <p className="body-sm">Recurring bills — rent, energy, broadband, subscriptions — split equally, by percentage, or paid entirely by one person. For bills that vary, you enter what each one actually came to.</p>
                <ul className="stack-sm">
                  <li className="body-sm">Who pays each provider, each person’s share, and who has paid.</li>
                  <li className="body-sm">One-off money lent between two people, all or part of it owed back.</li>
                  <li className="body-sm">A running balance with each person, part-payments, and live updates as things change.</li>
                  <li className="body-sm">Reminders before bills are due, scheduled on each phone.</li>
                </ul>
              </article>

              <article className="card card-lg stack">
                <div className="row-between">
                  <h3>Yours — private to you</h3>
                  <span className="pill is-settled">You only</span>
                </div>
                <p className="body-sm">A private space nobody else in the household can see, including whether you use it. Only your share of the household bills crosses inwards; nothing is ever written back.</p>
                <ul className="stack-sm">
                  <li className="body-sm">What’s left after bills, from your pay.</li>
                  <li className="body-sm">Bills that are yours alone, and an emergency fund.</li>
                  <li className="body-sm">A debt-payoff planner — snowball or avalanche, 0% offers, a debt-free date.</li>
                  <li className="body-sm">Reading a bank export (Monzo CSV and similar) on your device to find what you could cut.</li>
                </ul>
              </article>
            </div>

            <div className="card card-lg stack" style={{ marginTop: 'var(--space-6)' }}>
              <p className="eyebrow">The bit that’s different</p>
              <h3>Two reminders, two confirmations, one closed bill.</h3>
              <p className="body-sm cycle-note">Most splitting apps only chase the money. The awkward part of a shared house is earlier: somebody has to read the meter or say what this month’s number is. KTL treats that as its own step with its own deadline.</p>
              <div className="cycle" style={{ marginTop: 'var(--space-4)' }}>
                <div className="cycle-step">
                  <span className="cycle-rail"><span className="cycle-dot"><Icon name="pencil" size={12} /></span><span className="cycle-line" /></span>
                  <span className="cycle-body">
                    <span className="cycle-label">Five days out · both of you file the details</span>
                    <span className="cycle-note">Readings, usage, this month’s amount. Each person ticks that they’ve shared theirs, so nobody is guessing on the day.</span>
                  </span>
                </div>
                <div className="cycle-step">
                  <span className="cycle-rail"><span className="cycle-dot"><Icon name="send" size={12} /></span><span className="cycle-line" /></span>
                  <span className="cycle-body">
                    <span className="cycle-label">Two days out · whoever owes sends it</span>
                    <span className="cycle-note">The reminder carries the exact amount, the responsible bill payer, their account and the reference.</span>
                  </span>
                </div>
                <div className="cycle-step">
                  <span className="cycle-rail"><span className="cycle-dot"><Icon name="check" size={12} /></span></span>
                  <span className="cycle-body">
                    <span className="cycle-label">On arrival · the bill payer confirms</span>
                    <span className="cycle-note">Only their confirmation closes the line and clears it from the balance. Neither step closes on a notification being seen — each closes on a person tapping a confirmation.</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="grid-2" style={{ marginTop: 'var(--space-6)' }}>
              <article className="card card-lg stack">
                <div className="row-between">
                  <h3>Chase and confirm</h3>
                  <span className="pill is-scheduled">Default</span>
                </div>
                <p className="body-sm">Both of you are prompted and both of you confirm. Best when money genuinely moves between you every month.</p>
                <ul className="stack-sm">
                  <li className="body-sm">Details reminder five days out, money reminder two days out.</li>
                  <li className="body-sm">Anything unconfirmed gets one nudge after 24 hours.</li>
                </ul>
              </article>
              <article className="card card-lg stack">
                <div className="row-between">
                  <h3>Tracking only</h3>
                  <span className="pill is-settled">No chasing</span>
                </div>
                <p className="body-sm">KTL becomes a shared ledger rather than a chaser, for couples who settle up their own way and just want the numbers to agree.</p>
                <ul className="stack-sm">
                  <li className="body-sm">Costs, split and running balance still tracked in full.</li>
                  <li className="body-sm">Say you’ve paid and the line closes on the spot.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <Gallery />

        <section className="section" id="reach">
          <div className="container">
            <div className="head-lg">
              <p className="eyebrow">Away from home</p>
              <h2>Reaching it from outside your network</h2>
            </div>
            <div className="grid-2">
              <article className="card card-lg stack">
                <h3>Cloudflare Tunnel</h3>
                <p className="body-sm">No open ports needed. Create a tunnel in Cloudflare Zero Trust, add a public hostname pointing at the service, then paste the token on the admin page.</p>
                <ul className="stack-sm">
                  <li className="body-sm">Zero Trust → <strong>Networks → Tunnels</strong> → create a tunnel.</li>
                  <li className="body-sm">Add a public hostname (e.g. <code>ktl.example.com</code>) with service <code>http://localhost:3000</code>.</li>
                  <li className="body-sm">Paste the tunnel’s token under <strong>Cloudflare Tunnel</strong> on the admin page.</li>
                  <li className="body-sm">Set the address to <code>https://ktl.example.com</code>.</li>
                </ul>
              </article>
              <article className="card card-lg stack">
                <h3>Reverse proxy</h3>
                <p className="body-sm">Nginx Proxy Manager, SWAG, Caddy or Traefik works too: proxy your hostname to <code>http://&lt;server&gt;:8095</code> with HTTPS.</p>
                <ul className="stack-sm">
                  <li className="body-sm">Live updates use server-sent events — turn off response buffering on the proxy.</li>
                  <li className="body-sm">If the proxy is on another machine, set <code>KTL_TRUST_PROXY=true</code> so the server sees real client addresses (used for sign-in rate limits).</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="section" id="running">
          <div className="container">
            <div className="head-lg">
              <p className="eyebrow">Day two</p>
              <h2>Running it</h2>
            </div>
            <div className="split">
              <article className="card card-lg stack">
                <h3>Backups and restore</h3>
                <p className="body-sm">Each night a consistent copy of everything, accounts included, goes into <code>/data/backups</code>. The last 14 are kept and can be downloaded from the admin page. That folder is what your own backups should keep — copying <code>/data/postgres</code> while the server runs isn’t reliable.</p>
                <CodeBlock>{'docker exec -it ktl ktl-admin restore /data/backups/<file>.dump --yes'}</CodeBlock>
                <p className="body-sm">It saves the current data first, and runs in a single transaction.</p>
              </article>
              <article className="card card-lg stack">
                <h3>Updating and the terminal</h3>
                <p className="body-sm">To update, rebuild the image and recreate the container; database changes apply on start. From a terminal, <code>ktl-admin</code> covers the rest:</p>
                <CodeBlock>{'docker exec -it ktl ktl-admin help'}</CodeBlock>
                <p className="body-sm"><code>setup-code</code>, <code>status</code> and <code>users</code>; <code>reset-link</code> and <code>set-password</code> (for when there’s no email server); <code>backup</code>, <code>restore</code> and <code>import-json</code>. Health lives at <code>/healthz</code>, reporting the database, sign-in and data API.</p>
              </article>
            </div>

            <article className="card card-lg stack" style={{ marginTop: 'var(--space-6)' }}>
              <h3>Settings, and where they live</h3>
              <p className="body-sm" style={{ maxWidth: '68ch' }}>Everything is on the setup and admin pages. You can also set any of these on the container, which locks that setting — the admin page then shows it as “set by the container”.</p>
              <div style={{ overflowX: 'auto' }}>
                <table className="env-table">
                  <thead><tr><th>Variable</th><th>What it does</th></tr></thead>
                  <tbody>
                    {SETTINGS.map(([name, what]) => <tr key={name}><td>{name}</td><td>{what}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      </main>

      <footer className="pagefoot">
        <div className="container row-between">
          <p>
            KTL is self-hosted and open source under AGPL-3.0 — use, change and host it freely; if you run a modified version for other people, share your changes with them.
            Built on PostgreSQL, GoTrue, PostgREST, supabase-js, s6-overlay, React, Vite and Capacitor.
          </p>
          <p className="num" style={{ textAlign: 'right' }}>KTL · setup · {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
