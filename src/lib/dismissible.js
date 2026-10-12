import { useCallback, useState } from 'react';

const STORE_KEY = 'ktl:dismissed-notices';

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable — dismissal just won't persist this session
  }
}

/* A notice is dismissed only for the exact `signature` it was dismissed at.
   Pass something that changes whenever the underlying data the notice is
   about changes (e.g. a sorted, joined list of the relevant item ids) —
   the notice reappears automatically once the signature no longer matches. */
export function useDismissibleNotice(key, signature) {
  const [store, setStore] = useState(readStore);
  const dismissed = !!signature && store[key] === signature;

  const dismiss = useCallback(() => {
    const next = { ...readStore(), [key]: signature };
    writeStore(next);
    setStore(next);
  }, [key, signature]);

  return { dismissed, dismiss };
}
