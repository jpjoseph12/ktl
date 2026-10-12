import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { PasswordField, authMessage } from './android/Onboarding';
import PortalFrame, { StepRail, useAdmin } from './portal/PortalFrame';
import PeopleCard from './portal/PeopleCard';
import { AppCard, EmailCard, PushCard, SignupCard, TunnelCard } from './portal/SettingsCards';
import useIsTablet from '../lib/useIsTablet';
import { SERVER_URL } from '../lib/api';
import { MIN_PASSWORD_LENGTH, validEmail, validName, validPassword } from '../lib/validation';

/* First run, in the browser: everything a new KTL server needs, in order.
 *
 *   1. your server: the setup code (from the server's log), the address,
 *      your household and your own account — one step, so a half-set-up
 *      server can't exist
 *   2. the people you share with
 *   3. optional extras: sign-ups, email, push, a Cloudflare Tunnel
 *   4. done: the address to give the app
 *
 * On a computer the steps run down the left rail and "what you'll need"
 * sits beside the form; on a phone "what you'll need" is its own first
 * screen. Steps 2–3 are the same cards as the admin page, so anything
 * skipped here can be done there later. How to get a server running in the
 * first place is the guide in docs/, not here. */
const STEPS = [
  { id: 'claim', label: 'Your server' },
  { id: 'people', label: 'People' },
  { id: 'extras', label: 'Extras' },
  { id: 'done', label: 'Done' }
];

const NEED = [
  ['settings', 'The setup code', <>It’s in the server’s log. Run <code>docker logs ktl</code>, or open the container’s log in Unraid or Portainer, and look for “setup code”. It stops strangers on your network from claiming the server.</>],
  ['signal', 'The address people will use', <>For use away from home, put KTL behind a reverse proxy or a Cloudflare Tunnel and use that https:// address. For your own network only, this page’s address works.</>],
  ['users', 'Who you share with', <>Names and email addresses, up to six people including you. Each gets their own private space for pay and debts, and a one-time invite.</>],
  ['bell', 'Optional extras', <>An email server so people can reset passwords themselves, a Firebase project for push notifications, and a Cloudflare Tunnel token. All can be added later from the admin page.</>]
];

export default function Setup() {
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState('welcome');
  const desktop = useIsTablet();

  useEffect(() => {
    fetch(`${SERVER_URL}/api/setup`).then((r) => r.json()).then(setStatus).catch(() => setStatus({ ready: false }));
  }, []);

  const go = (next) => { setStep(next); window.scrollTo?.(0, 0); };
  const rail = <StepRail steps={STEPS} current={step === 'welcome' ? 'claim' : step} />;

  if (status?.ready && step === 'welcome') {
    return (
      <PortalFrame title="This server is set up" sub="Everything else is on the admin page, for the person who set it up.">
        <SetUpLinks />
      </PortalFrame>
    );
  }

  if (step === 'welcome' && !desktop) return <Welcome onNext={() => go('claim')} />;

  if (step === 'welcome' || step === 'claim') {
    return (
      <PortalFrame
        title="Your server"
        sub={desktop ? 'Step 1 of 3 — you’ll look after this server: adding people and changing settings.' : 'Step 1 of 3'}
        rail={rail}
        wide={desktop}
      >
        {desktop ? (
          <div className="portal-split">
            <section className="card card-lg"><ClaimForm onDone={() => go('people')} /></section>
            <NeedList />
          </div>
        ) : (
          <ClaimForm onDone={() => go('people')} />
        )}
      </PortalFrame>
    );
  }
  if (step === 'people') return <AfterClaim step="people" rail={rail} onNext={() => go('extras')} />;
  if (step === 'extras') return <AfterClaim step="extras" rail={rail} onNext={() => go('done')} />;
  return <Done rail={rail} />;
}

function SetUpLinks() {
  return (
    <div className="stack-sm">
      <Link className="btn btn-primary btn-block" to="/android/onboarding">Log in to KTL</Link>
      <Link className="btn btn-secondary btn-block" to="/admin">People and server settings</Link>
    </div>
  );
}

function NeedList() {
  return (
    <section className="stack">
      <div className="section-head"><h2>What you’ll need</h2></div>
      <div className="list">
        {NEED.map(([icon, title, body]) => (
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
  );
}

function Welcome({ onNext }) {
  return (
    <PortalFrame title="Set up KTL" sub="Shared household bills, with each person’s own finances kept private. This takes a couple of minutes.">
      <NeedList />
      <button className="btn btn-primary btn-block" onClick={onNext}>Start</button>
    </PortalFrame>
  );
}

/* The one step that claims the server: the code, the address, the
   household and the owner's account, together. */
function ClaimForm({ onDone }) {
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
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) claim(); }}>
      <div className="field">
        <label htmlFor="setup-code">Setup code</label>
        <input className="input num-input" id="setup-code" placeholder="ABCD-1234" autoComplete="off" autoCapitalize="characters" spellCheck="false" value={form.code} onChange={set('code')} />
        <span className="field-help">From the server’s log: <code>docker logs ktl</code></span>
      </div>
      <div className="field">
        <label htmlFor="setup-url">Address people will use</label>
        <input className="input" id="setup-url" autoCapitalize="off" spellCheck="false" value={form.siteUrl} onChange={set('siteUrl')} />
        <span className="field-help">You can change it later — once a tunnel or reverse proxy is in place.</span>
      </div>
      <div className="field">
        <label htmlFor="setup-household">Household name</label>
        <input className="input" id="setup-household" placeholder="e.g. Flat 4" value={form.household} onChange={set('household')} />
      </div>
      <hr className="divider" />
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
  );
}

function AfterClaim({ step, rail, onNext }) {
  const admin = useAdmin();
  if (step === 'people') {
    return (
      <PortalFrame title="Who you share with" sub="Step 2 of 3 — add everyone now, or later from the admin page." rail={rail}>
        {admin.error && <p className="hint"><Icon name="alert" size={16} /><span>{admin.error.message}</span></p>}
        <PeopleCard admin={admin} />
        <button className="btn btn-primary btn-block" onClick={onNext}>Next</button>
      </PortalFrame>
    );
  }
  return (
    <PortalFrame title="Optional extras" sub="Step 3 of 3 — skip any of these; they’re all on the admin page later." rail={rail}>
      <SignupCard admin={admin} />
      <EmailCard admin={admin} />
      <PushCard admin={admin} />
      <TunnelCard admin={admin} />
      <button className="btn btn-primary btn-block" onClick={onNext}>Finish</button>
    </PortalFrame>
  );
}

function Done({ rail }) {
  const admin = useAdmin();
  const url = admin.data?.siteUrl || SERVER_URL;
  return (
    <PortalFrame title="You’re set up" sub="Your household’s KTL is ready." rail={rail}>
      <AppCard siteUrl={url} />
      <section className="stack-sm">
        <div className="section-head"><h2>What’s next</h2></div>
        <ul className="stack-sm">
          <li className="body-sm">Open KTL to add your first shared bill — a short welcome walks you through it.</li>
          <li className="body-sm">Everything on this server — people, address, email, backups — is on the admin page, linked from House → Server.</li>
        </ul>
      </section>
      <section className="stack-sm">
        <Link className="btn btn-primary btn-block" to="/android/home">Open KTL</Link>
        <Link className="btn btn-secondary btn-block" to="/admin">Open the admin page</Link>
      </section>
    </PortalFrame>
  );
}
