import { useEffect, useState } from 'react';
import Icon from './Icon';
import { useAppLock } from '../context/AppLockContext';
import { LOCK_AFTER, validPin } from '../lib/appLock';
import { biometricsAvailable } from '../lib/biometrics';

function useBiometrics() {
  const [bio, setBio] = useState({ available: false, kind: '' });
  useEffect(() => { biometricsAvailable().then(setBio); }, []);
  return bio;
}

const bioLabel = (kind) => (kind === 'face' ? 'face' : kind === 'fingerprint' ? 'fingerprint' : 'fingerprint or face');

/* Choose a PIN (twice), then — where the phone has it — whether
   fingerprint or face can unlock too. Used by the first-run welcome and
   House → Security. */
export function LockSetup({ onDone, onCancel, change = false }) {
  const L = useAppLock();
  const bio = useBiometrics();
  const [pin, setPinValue] = useState('');
  const [again, setAgain] = useState('');
  const [useBio, setUseBio] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!validPin(pin)) { setError('Use 4 to 6 digits.'); return; }
    if (pin !== again) { setError('Those PINs don’t match.'); return; }
    setBusy(true);
    try {
      if (change) await L.changePin(pin);
      else await L.turnOn(pin, { biometrics: bio.available && useBio, after: 60 });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const digits = (set) => (e) => { set(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); };
  return (
    <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
      <div className="field">
        <label htmlFor="lock-pin">{change ? 'New PIN' : 'Choose a PIN'}</label>
        <input className="input num-input" id="lock-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={digits(setPinValue)} />
        <span className="field-help">4 to 6 digits, just for KTL on this device.</span>
      </div>
      <div className="field">
        <label htmlFor="lock-pin-again">The same PIN again</label>
        <input className="input num-input" id="lock-pin-again" type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={digits(setAgain)} />
      </div>
      {!change && bio.available && (
        <div className="row-between">
          <span className="body-sm">Unlock with your {bioLabel(bio.kind)} too</span>
          <button type="button" className="switch" role="switch" aria-checked={useBio} aria-label="Unlock with fingerprint or face" onClick={() => setUseBio((v) => !v)} />
        </div>
      )}
      {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !pin || !again}>{change ? 'Change PIN' : 'Turn on the lock'}</button>
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

/* House → Security. */
export default function SecuritySection() {
  const L = useAppLock();
  const bio = useBiometrics();
  const [editing, setEditing] = useState(null); // 'on' | 'change'

  return (
    <section className="stack">
      <div className="section-head"><h2>App lock</h2><span className="meta">{L.on ? 'On' : 'Off'}</span></div>
      <div className="card stack">
        <div className="row-between">
          <span className="body-sm">Ask for a PIN{bio.available ? ` or your ${bioLabel(bio.kind)}` : ''} to open KTL on this device</span>
          <button className="switch" role="switch" aria-checked={L.on} aria-label="App lock"
            onClick={() => (L.on ? L.turnOff() : setEditing('on'))} />
        </div>
        {editing && (
          <LockSetup change={editing === 'change'} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
        )}
        {L.on && !editing && (
          <>
            {bio.available && (
              <div className="row-between">
                <span className="body-sm">Unlock with your {bioLabel(bio.kind)}</span>
                <button className="switch" role="switch" aria-checked={Boolean(L.lock?.biometrics)} aria-label="Unlock with fingerprint or face"
                  onClick={() => L.setOption({ biometrics: !L.lock?.biometrics })} />
              </div>
            )}
            <div className="stack-sm">
              <p className="meta" id="lock-after-label">Lock again when you come back</p>
              <div className="seg" role="tablist" aria-labelledby="lock-after-label">
                {LOCK_AFTER.map((o) => (
                  <button key={o.seconds} type="button" role="tab" aria-selected={(L.lock?.after || 0) === o.seconds} onClick={() => L.setOption({ after: o.seconds })}>
                    {o.label.replace('After ', '')}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('change')}>Change PIN</button>
          </>
        )}
        <p className="meta">
          A lock on this device only, and only for you. It keeps KTL from being opened by whoever picks up your phone or computer,
          and hides it in the recent-apps view; it doesn’t encrypt what’s stored. Forget the PIN and you log in with your password instead.
        </p>
      </div>
    </section>
  );
}
