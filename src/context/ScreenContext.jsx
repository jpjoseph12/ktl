import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* Mirrors the original app.js "one open layer + one toast per document"
   model. Each screen mounts its own ScreenProvider, so navigating away
   always resets any open sheet/dialog — same as loading a fresh HTML file. */
const ScreenCtx = createContext(null);

export function useScreen() {
  const ctx = useContext(ScreenCtx);
  if (!ctx) throw new Error('useScreen must be used within ScreenProvider');
  return ctx;
}

export function ScreenProvider({ children }) {
  const [openId, setOpenId] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef(null);

  const open = useCallback((id) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);

  const toast = useCallback((message) => {
    setToastMsg(message);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 3200);
  }, []);

  useEffect(() => {
    function onKey(ev) {
      if (ev.key === 'Escape') setOpenId((cur) => (cur ? null : cur));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  return (
    <ScreenCtx.Provider value={{ openId, open, close, toast, toastMsg, toastVisible }}>
      {children}
    </ScreenCtx.Provider>
  );
}
