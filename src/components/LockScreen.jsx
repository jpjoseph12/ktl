import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import { clearLock, MAX_TRIES, resetFails, verifyPin } from '../lib/appLock';
import { confirmWithBiometrics } from '../lib/biometrics';
import '../styles/lock.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];

/* In front of everything while KTL is locked: the PIN pad, and — when it's
   turned on — fingerprint or face, offered straight away. Too many wrong
   PINs log out, so the password is needed again. */
export default function LockScreen({ userId, lock, onUnlock }) {
  const { signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const length = lock?.length || 6;

  const tryBiometrics = useCallback(async () => {
    if (!lock?.biometrics) return;
    if (await confirmWithBiometrics('Unlock KTL')) {
      resetFails(userId);
      onUnlock();
    }
  }, [lock, userId, onUnlock]);

  useEffect(() => { tryBiometrics(); }, [tryBiometrics]);

  const logOut = useCallback(async () => {
    clearLock(userId);
    await signOut().catch(() => {});
    onUnlock();
  }, [userId, signOut, onUnlock]);

  const check = useCallback(async (entered) => {
    setBusy(true);
    const { ok, remaining } = await verifyPin(userId, entered);
    setBusy(false);
    if (ok) { onUnlock(); return; }
    setPin('');
    if (remaining <= 0) { await logOut(); return; }
    setMessage(remaining === 1 ? 'Wrong PIN. One more try before you’re logged out.' : `Wrong PIN. ${remaining} tries left.`);
  }, [userId, onUnlock, logOut]);

  function press(key) {
    if (busy) return;
    if (key === 'bio') { tryBiometrics(); return; }
    if (key === 'del') { setPin((p) => p.slice(0, -1)); return; }
    const next = (pin + key).slice(0, 6);
    setPin(next);
    setMessage('');
    if (next.length === length) check(next);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter' && pin.length >= 4) check(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="KTL is locked">
      <div className="lock-inner">
        <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
        <h1 className="splash-wordmark">KTL is locked</h1>
        <p className="splash-tagline">Enter your PIN{lock?.biometrics ? ', or use your fingerprint or face' : ''}.</p>
        <div className="lock-dots" aria-label={`${pin.length} of ${length} digits entered`}>
          {Array.from({ length }, (_, i) => <span key={i} className={'lock-dot' + (i < pin.length ? ' on' : '')} />)}
        </div>
        <p className="lock-message" role="alert">{message}</p>
        <div className="lock-pad">
          {KEYS.map((k) => {
            if (k === 'bio') {
              return lock?.biometrics
                ? <button key={k} type="button" className="lock-key ghost" aria-label="Use fingerprint or face" onClick={() => press(k)}><Icon name="lock" size={22} /></button>
                : <span key={k} />;
            }
            if (k === 'del') return <button key={k} type="button" className="lock-key ghost" aria-label="Delete" onClick={() => press(k)}><Icon name="back" size={22} /></button>;
            return <button key={k} type="button" className="lock-key" onClick={() => press(k)}>{k}</button>;
          })}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logOut}>Forgot your PIN? Log out</button>
        <p className="meta" style={{ textAlign: 'center' }}>{MAX_TRIES} wrong PINs in a row log you out.</p>
      </div>
    </div>
  );
}
