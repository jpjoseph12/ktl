import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { PasswordField, authMessage } from './android/Onboarding';
import PortalFrame, { useAdmin } from './portal/PortalFrame';
import PeopleCard from './portal/PeopleCard';
import { AppCard, EmailCard, PushCard, SignupCard, TunnelCard } from './portal/SettingsCards';
import { SERVER_URL } from '../lib/api';
import { MIN_PASSWORD_LENGTH, validEmail, validName, validPassword } from '../lib/validation';

/* First run, in the browser: everything a new KTL server needs, in order.
 *
 *   1. what you'll need
 *   2. the setup code (from the server's log), the address, your household
 *      and your own account — one step, so a half-set-up server can't exist
 *   3. the people you share with
 *   4. optional extras: sign-ups, email, push, a Cloudflare Tunnel
 *   5. done: the address to give the app
 *
 * Steps 3–5 are the same cards as the admin page, so anything skipped here
 * can be done there later. */
export default function Setup() {
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState('welcome');

  useEffect(() => {
    fetch(`${SERVER_URL}/api/setup`).then((r) => r.json()).then(setStatus).catch(() => setStatus({ ready: false }));
  }, []);

  if (status?.ready && step === 'welcome') {
    return (
      <PortalFrame title="This server is set up" sub="Everything else is done from the admin page, as the person who set it up.">
        <div className="stack-sm">
          <Link className="btn btn-primary btn-block" to="/android/onboarding">Log in to KTL</Link>
          <Link className="btn btn-secondary btn-block" to="/admin">People and server settings</Link>
        </div>
      </PortalFrame>
    );
  }

  if (step === 'welcome') return <Welcome onNext={() => setStep('claim')} />;
  if (step === 'claim') return <Claim onDone={() => setStep('people')} />;
  if (step === 'people') return <AfterClaim step="people" onNext={() => setStep('extras')} />;
  if (step === 'extras') return <AfterClaim step="extras" onNext={() => setStep('done')} />;
  return <Done />;
}

function Welcome({ onNext }) {
  const need = [
    ['settings', 'The setup code', <>It’s in the server’s log. Run <code>docker logs ktl</code>, or open the container’s log in Unraid or Portainer, and look for “setup code”.</>],
    ['signal', 'The address people will use', <>For use away from home, put KTL behind a reverse proxy or a Cloudflare Tunnel and use that https:// address. For your own network only, this page’s address works.</>],
    ['users', 'Who you share with', <>Names and email addresses, up to six people including you. Each gets their own private space for pay and debts.</>],
    ['bell', 'Optional extras', <>An email server (so people can reset passwords themselves), a Firebase project (push notifications), a Cloudflare Tunnel token. All can be added later.</>]
  ];
  return (
    <PortalFrame title="Set up KTL" sub="Shared household bills, with each person’s own finances kept private. This takes a couple of minutes.">
      <section className="stack">
        <div className="section-head"><h2>What you’ll need</h2></div>
        <div className="list">
          {need.map(([icon, title, body]) => (
            <div className="item" key={title}>
              <span className="glyph on-warm"><Icon name={icon} size={18} /></span>
              <span className="grow">
                <span className="item-title" style={{ display: 'block' }}>{title}</span>
                <span className="item-sub">{body}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
      <button className="btn btn-primary btn-block" onClick={onNext}>Start</button>
    </PortalFrame>
  );
}

function Claim({ onDone }) {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ code: '', siteUrl: window.location.origin, household: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setValue = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const ready = form.code.trim().length >= 8 && form.household.trim() && validName(form.name) && validEmail(form.email) && validPassword(form.password);

  async function claim() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/setup/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Setup didn’t work. Try again.');
      await signIn(form.email.trim(), form.password);
      onDone();
    } catch (err) {
      setError(authMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalFrame title="Your server" sub="Step 1 of 3">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) claim(); }}>
        <div className="field">
          <label htmlFor="setup-code">Setup code</label>
          <input className="input num" id="setup-code" placeholder="ABCD-1234" autoComplete="off" autoCapitalize="characters" spellCheck="false" value={form.code} onChange={set('code')} />
          <span className="field-help">From the server’s log: <code>docker logs ktl</code></span>
        </div>
        <div className="field">
          <label htmlFor="setup-url">Address people will use</label>
          <input className="input" id="setup-url" autoCapitalize="off" spellCheck="false" value={form.siteUrl} onChange={set('siteUrl')} />
          <span className="field-help">You can change it later — for example once a tunnel or reverse proxy is in place.</span>
        </div>
        <div className="field">
          <label htmlFor="setup-household">Household name</label>
          <input className="input" id="setup-household" placeholder="e.g. Flat 4" value={form.household} onChange={set('household')} />
        </div>
        <hr className="divider" />
        <p className="item-title">You</p>
        <p className="meta">You’ll look after this server: adding people and changing settings.</p>
        <div className="field">
          <label htmlFor="setup-name">Your name</label>
          <input className="input" id="setup-name" autoComplete="name" value={form.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="setup-email">Your email</label>
          <input className="input" id="setup-email" type="email" autoComplete="email" autoCapitalize="off" value={form.email} onChange={set('email')} />
        </div>
        <PasswordField id="setup-password" label="Password" value={form.password} onChange={setValue('password')} autoComplete="new-password" help={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
          {busy ? 'Setting up…' : 'Set up the server'}
        </button>
      </form>
    </PortalFrame>
  );
}

function AfterClaim({ step, onNext }) {
  const admin = useAdmin();
  if (step === 'people') {
    return (
      <PortalFrame title="Who you share with" sub="Step 2 of 3 — add everyone now, or later from House → Server.">
        {admin.error && <p className="hint"><Icon name="alert" size={16} /><span>{admin.error.message}</span></p>}
        <PeopleCard admin={admin} />
        <button className="btn btn-primary btn-block" onClick={onNext}>Next</button>
      </PortalFrame>
    );
  }
  return (
    <PortalFrame title="Optional extras" sub="Step 3 of 3 — skip any of these; they’re all on the admin page later.">
      <SignupCard admin={admin} />
      <EmailCard admin={admin} />
      <PushCard admin={admin} />
      <TunnelCard admin={admin} />
      <button className="btn btn-primary btn-block" onClick={onNext}>Finish</button>
    </PortalFrame>
  );
}

function Done() {
  const admin = useAdmin();
  const url = admin.data?.siteUrl || SERVER_URL;
  return (
    <PortalFrame title="You’re set up" sub="Your household’s KTL is ready.">
      <AppCard siteUrl={url} />
      <section className="stack-sm">
        <Link className="btn btn-primary btn-block" to="/android/home">Open KTL</Link>
        <Link className="btn btn-secondary btn-block" to="/admin">People and server settings</Link>
      </section>
    </PortalFrame>
  );
}
