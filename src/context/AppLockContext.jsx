import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useAuth } from './AuthContext';
import { clearLock, readLock, setPin, shouldRelock, updateLock } from '../lib/appLock';
import { setPrivacyScreen } from '../lib/biometrics';
import LockScreen from '../components/LockScreen';

const LockCtx = createContext(null);

export function useAppLock() {
  const ctx = useContext(LockCtx);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}

/* Locks KTL behind the PIN when it's opened with someone already signed
   in, and when it comes back after being away for longer than they chose.
   Signing in with a password doesn't then ask for the PIN as well. */
export function AppLockProvider({ children }) {
  const { user, loading } = useAuth();
  const uid = user?.id || null;
  const [lock, setLock] = useState(null);
  const [locked, setLocked] = useState(false);
  const firstUser = useRef(true);
  const awaySince = useRef(null);

  useEffect(() => {
    if (loading) return;
    const current = readLock(uid);
    setLock(current);
    // Only a session restored at start-up is locked; a fresh sign-in isn't.
    setLocked(firstUser.current && Boolean(current));
    firstUser.current = false;
    setPrivacyScreen(Boolean(current));
  }, [uid, loading]);

  useEffect(() => {
    const away = () => { awaySince.current = Date.now(); };
    const back = () => {
      const since = awaySince.current;
      awaySince.current = null;
      const current = readLock(uid);
      if (since !== null && shouldRelock(current, (Date.now() - since) / 1000)) setLocked(true);
    };
    if (Capacitor.isNativePlatform()) {
      const p = CapApp.addListener('pause', away);
      const r = CapApp.addListener('resume', back);
      return () => { p.then((l) => l.remove()); r.then((l) => l.remove()); };
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uid]);

  const refresh = useCallback(() => {
    const current = readLock(uid);
    setLock(current);
    setPrivacyScreen(Boolean(current));
  }, [uid]);

  const turnOn = useCallback(async (pin, options) => { await setPin(uid, pin, options); refresh(); }, [uid, refresh]);
  const changePin = useCallback(async (pin) => { await setPin(uid, pin); refresh(); }, [uid, refresh]);
  const turnOff = useCallback(() => { clearLock(uid); setLocked(false); refresh(); }, [uid, refresh]);
  const setOption = useCallback((patch) => { updateLock(uid, patch); refresh(); }, [uid, refresh]);
  const unlock = useCallback(() => setLocked(false), []);

  const value = useMemo(() => ({
    lock, on: Boolean(lock), locked: Boolean(uid) && locked, turnOn, changePin, turnOff, setOption, unlock
  }), [lock, uid, locked, turnOn, changePin, turnOff, setOption, unlock]);

  return (
    <LockCtx.Provider value={value}>
      {children}
      {value.locked && <LockScreen userId={uid} lock={lock} onUnlock={unlock} />}
    </LockCtx.Provider>
  );
}
