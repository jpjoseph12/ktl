import { useState } from 'react';
import Icon from '../../components/Icon';
import CopyButton from '../../components/CopyButton';
import { api, apiFetch, SERVER_URL } from '../../lib/api';
import { saveFile } from '../../lib/saveFile';

/* The server settings on the setup and admin pages. Each card saves on
   its own. A setting the container's environment fixes is shown, but
   can only be changed where it was set. */

export function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function run(fn, message) {
    setError('');
    setDone('');
    setBusy(true);
    try {
      await fn();
      if (message) setDone(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const feedback = (
    <>
      {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
      {done && <p className="meta">{done}</p>}
    </>
  );
  return { busy, run, feedback };
}

export const FromContainer = () => (
  <p className="meta">Set by the container’s environment — change it there.</p>
);

export function AddressCard({ admin }) {
  const { data, save } = admin;
  const s = data?.settings.siteUrl;
  const [url, setUrl] = useState(s?.value || (typeof window !== 'undefined' ? window.location.origin : ''));
  const [tested, setTested] = useState('');
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  return (
    <section className="stack">
      <div className="section-head"><h2>Address</h2></div>
      <div className="card stack-sm">
        <p className="body-sm">
          The address people open KTL at, and type into the app. Password-reset links use it too.
        </p>
        <div className="row-between">
          <code style={{ wordBreak: 'break-all' }}>{data.siteUrl}</code>
          <CopyButton className="btn btn-secondary btn-sm" text={data.siteUrl} toastMsg="Address copied"><Icon name="copy" size={16} />Copy</CopyButton>
        </div>
        {s?.source === 'container' ? <FromContainer /> : (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); run(() => save({ siteUrl: url }), 'Saved. Sign-in restarts with it in a few seconds.'); }}>
            <div className="field">
              <label htmlFor="site-url">Change it</label>
              <input className="input" id="site-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ktl.example.com" autoCapitalize="off" spellCheck="false" />
              <span className="field-help">Behind a reverse proxy or Cloudflare Tunnel, that’s its https:// address. On your own network only, it can be http://&lt;server&gt;:&lt;port&gt;.</span>
            </div>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Save address</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !url.trim()} onClick={() => run(async () => {
                setTested('');
                const r = await apiFetch('/api/admin/test-address', { method: 'POST', body: { url } });
                if (!r.ok) throw new Error(r.message);
                setTested(r.message);
              })}>
                Test this address
              </button>
            </div>
          </form>
        )}
        {tested && <p className="meta">{tested}</p>}
        {feedback}
      </div>
    </section>
  );
}

export function SignupCard({ admin }) {
  const { data, save } = admin;
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  const s = data.settings.signup;
  const open = s.value === 'true';
  return (
    <section className="stack">
      <div className="section-head"><h2>Sign-ups</h2><span className="meta">{open ? 'Open' : 'Closed'}</span></div>
      <div className="card stack-sm">
        <div className="row-between">
          <span className="body-sm">Let anyone who reaches this server create an account</span>
          <button
            className="switch" role="switch" aria-checked={open} aria-label="Open sign-ups"
            disabled={busy || s.source === 'container'}
            onClick={() => run(() => save({ signup: !open }))}
          />
        </div>
        <p className="meta">
          Best left closed: add people above instead. Anyone who signs up joins your household (up to six people).
        </p>
        {s.source === 'container' && <FromContainer />}
        {feedback}
      </div>
    </section>
  );
}

export function EmailCard({ admin }) {
  const { data, save } = admin;
  const st = data?.settings;
  const [form, setForm] = useState(() => ({
    smtpHost: st?.smtpHost.value || '', smtpPort: st?.smtpPort.value || '587',
    smtpUser: st?.smtpUser.value || '', smtpPass: '', smtpSender: st?.smtpSender.value || '',
    smtpSenderName: st?.smtpSenderName?.value || ''
  }));
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  const locked = st.smtpHost.source === 'container';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function saveEmail() {
    const changes = { smtpHost: form.smtpHost, smtpPort: form.smtpPort, smtpUser: form.smtpUser, smtpSender: form.smtpSender, smtpSenderName: form.smtpSenderName };
    if (form.smtpPass) changes.smtpPass = form.smtpPass;
    return run(async () => { await save(changes); setForm((f) => ({ ...f, smtpPass: '' })); }, 'Saved. Give it a few seconds, then send a test.');
  }

  return (
    <section className="stack">
      <div className="section-head"><h2>Email</h2><span className="meta">{st.smtpHost.set ? 'On' : 'Optional'}</span></div>
      <div className="card stack-sm">
        <p className="body-sm">
          Only used so people can reset their own password. Without it, you make them a sign-in link under People.
          Any SMTP service works: your email provider’s, Brevo, Resend, Mailgun…
        </p>
        {locked ? <FromContainer /> : (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); saveEmail(); }}>
            <div className="field"><label htmlFor="smtp-host">SMTP server</label><input className="input" id="smtp-host" value={form.smtpHost} onChange={set('smtpHost')} placeholder="smtp.example.com" autoCapitalize="off" /></div>
            <div className="field"><label htmlFor="smtp-port">Port</label><input className="input num-input" id="smtp-port" inputMode="numeric" value={form.smtpPort} onChange={set('smtpPort')} /></div>
            <div className="field"><label htmlFor="smtp-user">Username</label><input className="input" id="smtp-user" value={form.smtpUser} onChange={set('smtpUser')} autoComplete="off" autoCapitalize="off" /></div>
            <div className="field">
              <label htmlFor="smtp-pass">Password</label>
              <input className="input" id="smtp-pass" type="password" value={form.smtpPass} onChange={set('smtpPass')} autoComplete="new-password" placeholder={st.smtpPass.set ? 'Saved — type to replace' : ''} />
            </div>
            <div className="field"><label htmlFor="smtp-sender">Send from</label><input className="input" id="smtp-sender" type="email" value={form.smtpSender} onChange={set('smtpSender')} placeholder="ktl@example.com" autoCapitalize="off" /></div>
            <div className="field">
              <label htmlFor="smtp-sender-name">Sender name</label>
              <input className="input" id="smtp-sender-name" value={form.smtpSenderName} onChange={set('smtpSenderName')} placeholder="KTL" maxLength={60} />
              <span className="field-help">What people see the email as coming from.</span>
            </div>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Save email</button>
              {st.smtpHost.set && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => {
                  const r = await apiFetch('/api/admin/email-test', { method: 'POST' });
                  return r;
                }, 'Sent a password-reset email to you. If it arrives, email works.')}>
                  Send me a test
                </button>
              )}
              {st.smtpHost.set && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => {
                  await save({ smtpHost: '', smtpPort: '', smtpUser: '', smtpPass: '', smtpSender: '', smtpSenderName: '' });
                  setForm({ smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', smtpSender: '', smtpSenderName: '' });
                }, 'Email is off, and the saved details are gone.')}>
                  Turn email off
                </button>
              )}
            </div>
          </form>
        )}
        {feedback}
      </div>
    </section>
  );
}

export function PushCard({ admin }) {
  const { data, setData } = admin;
  const [key, setKey] = useState('');
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  const push = data.push;

  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setKey(await file.text());
  }

  return (
    <section className="stack">
      <div className="section-head"><h2>Push notifications</h2><span className="meta">{push.configured ? 'On' : 'Optional'}</span></div>
      <div className="card stack-sm">
        <p className="body-sm">
          Tells people’s phones when someone else does something, even with KTL closed. It needs a Firebase project of your own,
          and an Android app built with that project’s <code>google-services.json</code> (see the README). Without it, KTL still
          updates live while it’s open, and bill reminders still come from the phone itself.
        </p>
        {push.configured && <p className="meta">On, with Firebase project <strong>{push.projectId}</strong>.</p>}
        {push.fromContainer ? <FromContainer /> : (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); run(async () => { setData(await apiFetch('/api/admin/push', { method: 'PUT', body: { serviceAccount: key } })); setKey(''); }, 'Saved. Push is on.'); }}>
            <div className="field">
              <label htmlFor="push-key">Service-account key (JSON)</label>
              <textarea className="input" id="push-key" rows={4} value={key} onChange={(e) => setKey(e.target.value)} placeholder='{ "type": "service_account", … }' spellCheck="false" />
              <span className="field-help">Firebase → Project settings → Service accounts → Generate new private key. Paste it, or choose the file.</span>
            </div>
            <input type="file" accept=".json,application/json" aria-label="Choose the key file" onChange={readFile} />
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !key.trim()}>Save key</button>
              {push.configured && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => setData(await apiFetch('/api/admin/push', { method: 'DELETE' })), 'Push is off.')}>
                  Turn push off
                </button>
              )}
            </div>
          </form>
        )}
        {feedback}
      </div>
    </section>
  );
}

export function TunnelCard({ admin }) {
  const { data, save } = admin;
  const [token, setToken] = useState('');
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  const t = data.settings.tunnelToken;
  return (
    <section className="stack">
      <div className="section-head"><h2>Cloudflare Tunnel</h2><span className="meta">{t.set ? 'On' : 'Optional'}</span></div>
      <div className="card stack-sm">
        <p className="body-sm">
          Reach KTL from anywhere with no open ports. In Cloudflare Zero Trust, create a tunnel, give it a public hostname
          pointing at <code>http://localhost:3000</code>, and paste its token here. Already running a reverse proxy or your
          own tunnel? Leave this empty.
        </p>
        {t.source === 'container' ? <FromContainer /> : (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); run(async () => { await save({ tunnelToken: token }); setToken(''); }, token ? 'Saved. The tunnel starts in a few seconds — then set the address to its hostname under Sign-in & address.' : 'Tunnel off.'); }}>
            <div className="field">
              <label htmlFor="tunnel-token">Tunnel token</label>
              <input className="input" id="tunnel-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={t.set ? 'Saved — type to replace' : ''} />
            </div>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !token.trim()}>Save token</button>
              {t.set && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => save({ tunnelToken: '' }), 'Tunnel off.')}>Turn off</button>}
            </div>
          </form>
        )}
        {feedback}
      </div>
    </section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const kind = (name) => (/-manual\./.test(name) ? 'Taken by hand' : /-before-restore\./.test(name) ? 'Saved before a restore' : /-uploaded-/.test(name) ? 'Uploaded' : 'Nightly');

/* Backups: when they're taken and how many are kept, the list (download
   or restore any of them), taking one now, and adding a backup file from
   elsewhere to restore. */
export function BackupsCard({ admin }) {
  const { data, setData, save } = admin;
  const [schedule, setSchedule] = useState(() => ({
    hour: String(data?.schedule?.hour ?? 3), keep: String(data?.schedule?.keep ?? 14), timezone: data?.schedule?.timezone || 'Europe/London'
  }));
  const [restoring, setRestoring] = useState(null);
  const [typed, setTyped] = useState('');
  const [restored, setRestored] = useState('');
  const { busy, run, feedback } = useSaver();
  if (!data) return null;
  const st = data.settings;
  const lockedSchedule = [st.backupHour, st.backupKeep, st.timezone].some((x) => x?.source === 'container');

  // Downloads need the owner's token, so they go through fetch, not a link.
  const download = (name) => run(async () => {
    const { data: s } = await api.auth.getSession();
    const res = await fetch(`${SERVER_URL}/api/admin/backups/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${s.session?.access_token}` }
    });
    if (!res.ok) throw new Error('That backup couldn’t be downloaded.');
    await saveFile(name, await res.blob());
  });

  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(async () => {
      const { data: s } = await api.auth.getSession();
      const res = await fetch(`${SERVER_URL}/api/admin/backups/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.session?.access_token}`, 'Content-Type': 'application/octet-stream' },
        body: file
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'That backup couldn’t be uploaded.');
      setData(json);
      setRestoring(json.uploaded);
    }, 'Uploaded. Restore it below, or leave it in the list for later.');
  };

  const restore = (name) => run(async () => {
    const r = await apiFetch('/api/admin/restore', { method: 'POST', body: { name, confirm: typed } });
    setRestoring(null);
    setTyped('');
    setRestored(`Restored ${r.restored}. Your data from before is saved as ${r.safetyCopy}. Everyone needs to log in again.`);
  });

  const list = [...data.backups].reverse();
  return (
    <section className="stack">
      <div className="section-head"><h2>Backups</h2><span className="meta">{data.schedule?.keep ? `Nightly, ${data.schedule.keep} kept` : 'Nightly backups off'}</span></div>

      <div className="card stack-sm">
        <p className="body-sm">
          A consistent copy of everything, accounts included, goes into the server’s <code>/data/backups</code>. That folder is
          what your own backups should keep — copying the database folder while the server runs isn’t reliable.
        </p>
        {lockedSchedule ? <FromContainer /> : (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); run(async () => {
            await save({ backupHour: Number(schedule.hour), backupKeep: Number(schedule.keep), timezone: schedule.timezone });
          }, 'Saved. It applies from the next half-hourly check.'); }}>
            <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: 120 }}>
                <label htmlFor="backup-hour">Each night at</label>
                <select className="input" id="backup-hour" value={schedule.hour} onChange={(e) => setSchedule((x) => ({ ...x, hour: e.target.value }))}>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
              <div className="field" style={{ minWidth: 120 }}>
                <label htmlFor="backup-keep">Keep the last</label>
                <input className="input num-input" id="backup-keep" inputMode="numeric" value={schedule.keep} onChange={(e) => setSchedule((x) => ({ ...x, keep: e.target.value.replace(/\D/g, '') }))} />
              </div>
              <div className="field grow" style={{ minWidth: 180 }}>
                <label htmlFor="backup-tz">Time zone</label>
                <input className="input" id="backup-tz" value={schedule.timezone} onChange={(e) => setSchedule((x) => ({ ...x, timezone: e.target.value }))} placeholder="Europe/London" autoCapitalize="off" spellCheck="false" />
              </div>
            </div>
            <span className="field-help">Keep 0 to turn nightly backups off. Ones you take by hand, upload, or that are saved before a restore are never deleted.</span>
            <button type="submit" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}>Save schedule</button>
          </form>
        )}
      </div>

      <div className="card stack-sm">
        <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={() => run(async () => setData(await apiFetch('/api/admin/backups', { method: 'POST' })), 'Backed up.')}>
            Back up now
          </button>
          <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            Upload a backup…
            <input type="file" accept=".dump,application/octet-stream" onChange={upload} style={{ display: 'none' }} aria-label="Upload a backup file" />
          </label>
        </div>
        {list.length ? list.map((b) => (
          <div key={b.name} className="stack-sm" style={{ padding: 'var(--space-2) 0', borderTop: '1px solid var(--border-soft)' }}>
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <span className="grow" style={{ minWidth: 200 }}>
                <span className="body-sm num" style={{ display: 'block' }}>{b.name}</span>
                <span className="meta">{kind(b.name)} · {mb(b.size)}</span>
              </span>
              <span className="row" style={{ gap: 'var(--space-1)' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => download(b.name)}>Download</button>
                <button className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={restoring === b.name} onClick={() => { setRestoring(restoring === b.name ? null : b.name); setTyped(''); }}>Restore</button>
              </span>
            </div>
            {restoring === b.name && (
              <form className="hint" onSubmit={(e) => { e.preventDefault(); if (typed === 'REPLACE') restore(b.name); }}>
                <Icon name="alert" size={16} />
                <span className="stack-sm grow">
                  <span>
                    This replaces <strong>everything</strong> on this server — every bill, balance, private space and account — with
                    this backup. Your current data is saved as a backup first. Everyone will need to log in again.
                  </span>
                  <span className="field">
                    <label htmlFor={`confirm-${b.name}`}>Type REPLACE to confirm</label>
                    <input className="input" id={`confirm-${b.name}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
                  </span>
                  <span className="row" style={{ gap: 'var(--space-2)' }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || typed !== 'REPLACE'}>{busy ? 'Restoring…' : 'Restore this backup'}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRestoring(null)}>Cancel</button>
                  </span>
                </span>
              </form>
            )}
          </div>
        )) : <p className="meta">None yet — the first is taken tonight.</p>}
        {restored && (
          <div className="hint">
            <Icon name="check" size={16} />
            <span>{restored} <button type="button" onClick={() => window.location.assign('/android/onboarding')}>Log in again</button></span>
          </div>
        )}
        {feedback}
      </div>
    </section>
  );
}

export function AppCard({ siteUrl = SERVER_URL }) {
  return (
    <section className="stack">
      <div className="section-head"><h2>The app</h2></div>
      <div className="card stack-sm">
        <p className="body-sm">
          On a computer or tablet, just open <strong>{siteUrl}</strong>. In the KTL Android app, enter that address when it
          asks which server to use.
        </p>
      </div>
    </section>
  );
}
