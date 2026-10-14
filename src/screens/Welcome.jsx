import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PhoneShell from '../components/PhoneShell';
import { TabletCenteredShell } from '../components/tablet/TabletShell';
import { LockSetup } from '../components/LockSettings';
import { useAppLock } from '../context/AppLockContext';
import { useKettle } from '../context/KettleContext';
import { usePrivate } from '../context/PrivateContext';
import { useWalkthrough } from '../context/WalkthroughContext';
import useIsTablet, { CENTERED_QUERY } from '../lib/useIsTablet';
import { IS_NATIVE } from '../lib/api';
import { permissionState, requestPermission } from '../lib/notifications';
import { validName } from '../lib/validation';

/* The first time someone opens KTL: who's here and their name, optionally
   their own pay and debts, this device's reminders and lock, then into the
   app — with the tour if they'd like it. Shown once per person (it's
   recorded on their profile), and skippable at every step. */
const STEPS = ['hello', 'private', 'device', 'done'];

function Frame({ step, children }) {
  const wide = useIsTablet(CENTERED_QUERY);
  const body = (
    <main className="scroll">
      <div className="stack" style={{ paddingTop: 'var(--space-6)' }}>
        <p className="meta" aria-live="polite">Step {STEPS.indexOf(step) + 1} of {STEPS.length}</p>
        {children}
      </div>
    </main>
  );
  return wide ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell> : <PhoneShell platform="android">{body}</PhoneShell>;
}

const amount = (v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim());

export default function Welcome() {
  const K = useKettle();
  const M = usePrivate();
  const L = useAppLock();
  const W = useWalkthrough();
  const navigate = useNavigate();
  const [step, setStep] = useState('hello');
  const [name, setName] = useState(K.you?.name && K.you.name !== 'You' && K.you.name !== 'New user' ? K.you.name : '');
  const [income, setIncome] = useState(M.state.income ? String(M.state.income) : '');
  const [payday, setPayday] = useState(M.state.payday || '');
  const [debts, setDebts] = useState(Boolean(M.state.debtModule));
  const [notify, setNotify] = useState('unavailable');
  const [locking, setLocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const household = K.data.household;
  const members = K.members || [];
  const isOwner = members.find((m) => m.id === K.you?.id)?.role === 'owner';

  useEffect(() => { if (IS_NATIVE) permissionState().then(setNotify); }, []);

  async function run(fn) {
    setError('');
    setBusy(true);
    try { await fn(); } catch (err) { setError(err.message || 'That didn’t save. Try again.'); } finally { setBusy(false); }
  }

  const saveName = () => run(async () => {
    if (!validName(name)) throw new Error('Enter the name you’d like your household to see.');
    if (name.trim() !== K.you?.name) await K.updateMyName(name.trim());
    setStep('private');
  });

  const savePrivate = () => run(async () => {
    if (income && !amount(income)) throw new Error('Enter your take-home pay as a number, like 2150 or 2150.50.');
    const patch = {};
    if (income) patch.income = parseFloat(income);
    if (payday.trim()) patch.payday = payday.trim();
    if (Object.keys(patch).length) await M.setMany(patch);
    if (debts !== Boolean(M.state.debtModule)) await M.set('debtModule', debts);
    setStep('device');
  });

  const finish = (tour) => run(async () => {
    await K.finishFirstRun();
    W.skip(); // marks the tour seen, so it never starts by itself after this
    navigate('/android/home', { replace: true });
    if (tour) setTimeout(() => W.restart(), 0);
  });

  if (step === 'hello') {
    return (
      <Frame step={step}>
        <h1 style={{ margin: 0 }}>Welcome to {household.name || 'KTL'}</h1>
        <p className="body-sm">
          KTL splits your household’s shared bills and keeps one honest balance between you — and gives you a private space for your own money that nobody else can see.
        </p>
        {isOwner && (
          <p className="hint"><Icon name="settings" size={16} /><span>Your server is set up. People, the address, email and backups are all under <strong>House → Server → People and server settings</strong>.</span></p>
        )}
        {members.length > 0 && (
          <section className="stack-sm">
            <div className="section-head"><h2>Who’s here</h2><span className="meta">{members.length} of 6</span></div>
            <div className="list">
              {members.map((m) => (
                <div className="item" key={m.id}>
                  <span className={'avatar' + (m.id === K.you?.id ? ' you' : '')}>{m.initials}</span>
                  <span className="grow item-title">{m.id === K.you?.id ? 'You' : m.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!busy) saveName(); }}>
          <div className="field">
            <label htmlFor="welcome-name">Your name</label>
            <input className="input" id="welcome-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <span className="field-help">What everyone in the household sees.</span>
          </div>
          {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Next</button>
        </form>
      </Frame>
    );
  }

  if (step === 'private') {
    return (
      <Frame step={step}>
        <h1 style={{ margin: 0 }}>Your private space</h1>
        <p className="hint"><Icon name="lock" size={16} /><span>Only you can see this — not even whether you use it. Only your share of the shared bills comes in; nothing goes out.</span></p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!busy) savePrivate(); }}>
          <div className="field">
            <label htmlFor="welcome-income">Take-home pay each month</label>
            <input className="input num-input" id="welcome-income" inputMode="decimal" placeholder="e.g. 2150" value={income} onChange={(e) => setIncome(e.target.value)} />
            <span className="field-help">After tax. KTL works out what’s left after bills.</span>
          </div>
          <div className="field">
            <label htmlFor="welcome-payday">Payday</label>
            <input className="input" id="welcome-payday" placeholder="e.g. 28th, or last Friday" value={payday} onChange={(e) => setPayday(e.target.value)} />
          </div>
          <div className="row-between">
            <span className="body-sm">Plan paying off cards or loans</span>
            <button type="button" className="switch" role="switch" aria-checked={debts} aria-label="Debt planner" onClick={() => setDebts((v) => !v)} />
          </div>
          {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>Next</button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('device')}>Skip for now</button>
        </form>
      </Frame>
    );
  }

  if (step === 'device') {
    return (
      <Frame step={step}>
        <h1 style={{ margin: 0 }}>This {IS_NATIVE ? 'phone' : 'device'}</h1>
        {IS_NATIVE && (
          <section className="stack-sm">
            <div className="section-head"><h2>Reminders</h2><span className="meta">{notify === 'granted' ? 'On' : 'Off'}</span></div>
            <div className="card stack-sm">
              <p className="body-sm">A nudge before each bill — first to share the details, then to send your share.</p>
              {notify === 'granted'
                ? <p className="meta"><Icon name="check" size={14} /> Reminders are on.</p>
                : <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => setNotify(await requestPermission())}>Turn on reminders</button>}
              {notify === 'denied' && <p className="meta">Turned off in your phone’s settings — turn on notifications for KTL there.</p>}
            </div>
          </section>
        )}
        <section className="stack-sm">
          <div className="section-head"><h2>App lock</h2><span className="meta">{L.on ? 'On' : 'Off'}</span></div>
          <div className="card stack-sm">
            <p className="body-sm">Ask for a PIN{IS_NATIVE ? ', fingerprint or face' : ''} to open KTL here. You can change this any time under House → App lock.</p>
            {L.on && <p className="meta"><Icon name="check" size={14} /> The lock is on.</p>}
            {!L.on && !locking && <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLocking(true)}>Set a PIN</button>}
            {!L.on && locking && <LockSetup onDone={() => setLocking(false)} onCancel={() => setLocking(false)} />}
          </div>
        </section>
        <button className="btn btn-primary btn-block" onClick={() => setStep('done')}>Next</button>
      </Frame>
    );
  }

  return (
    <Frame step={step}>
      <h1 style={{ margin: 0 }}>You’re in</h1>
      <p className="body-sm">
        {K.data.bills.length
          ? 'Your household’s bills are already here. A short tour shows where everything is.'
          : 'Next, add your first shared bill. A short tour shows you how.'}
      </p>
      {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => finish(true)}>Show me around</button>
      <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => finish(false)}>Go to Home</button>
      {isOwner && <Link className="btn btn-ghost btn-block" to="/admin" onClick={() => K.finishFirstRun().catch(() => {})}>People and server settings</Link>}
    </Frame>
  );
}
