import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useKettle } from './KettleContext';
import { usePrivate } from './PrivateContext';

const SEEN_PREFIX = 'ktl:walkthrough-seen:';

function hasSeen(userId) {
  try {
    return localStorage.getItem(SEEN_PREFIX + userId) === '1';
  } catch {
    return true;
  }
}
function markSeen(userId) {
  try {
    localStorage.setItem(SEEN_PREFIX + userId, '1');
  } catch {
    // no persistence available — the tour just won't self-suppress next launch
  }
}

/* Each step names the screen it belongs to (the provider navigates there),
   an optional `target` key a screen registers its real DOM element under
   (no target = a plain centered card), and an optional `doneWhen` used both
   to skip a step that's already satisfied and to auto-advance once the user
   actually completes the real action. `next` can branch on live state. */
const STEPS = {
  welcome: {
    route: '/android/home',
    target: null,
    title: 'Let’s get KTL set up',
    body: 'A quick walkthrough — your first shared bill, your pay, and anything you’re paying off. Skip anytime.',
    cta: 'Let’s go',
    next: () => 'household-people'
  },
  'household-people': {
    route: '/android/household',
    target: 'household-people',
    title: 'Who you share with',
    body: 'Everyone with an account on this server is in this household. Whoever runs the server adds people — under Server → People and server settings.',
    doneWhen: (K) => !!K.partner,
    next: () => 'add-first-bill'
  },
  'add-first-bill': {
    route: '/android/bills',
    target: 'add-first-bill',
    title: 'Add your first shared bill',
    body: 'Rent, council tax, energy — whatever you actually split.',
    doneWhen: (K) => K.data.bills.length > 0,
    next: () => 'add-income'
  },
  'add-income': {
    route: '/android/yours',
    target: 'add-income',
    title: 'Add your take-home pay',
    body: 'Private to you — this is what works out what’s left after bills.',
    doneWhen: (K, M) => !!M.state.income,
    next: () => 'toggle-debt'
  },
  'toggle-debt': {
    route: '/android/yours',
    target: 'toggle-debt',
    title: 'Track a card or loan?',
    body: 'Optional — turn this on for a real payoff date. Skip if it doesn’t apply to you.',
    next: (K, M) => (M.state.debtModule ? 'add-debt' : 'add-personal-bill')
  },
  'add-debt': {
    route: '/android/yours',
    target: 'add-debt',
    title: 'Add a card or loan',
    body: 'Balance, minimum payment and rate — KTL works out a real payoff date.',
    doneWhen: (K, M) => M.state.debts.length > 0,
    next: () => 'add-personal-bill'
  },
  'add-personal-bill': {
    route: '/android/yours',
    target: 'add-personal-bill',
    title: 'Add a bill that’s just yours',
    body: 'Phone, car, gym — anything that never touches the household split.',
    doneWhen: (K, M) => M.state.personal.length > 0,
    next: () => 'done'
  },
  done: {
    route: '/android/home',
    target: null,
    title: 'You’re all set',
    body: 'Revisit any of this anytime — House → Restart the walkthrough.',
    cta: 'Finish',
    next: () => null
  }
};
const ORDER = Object.keys(STEPS);

const WalkthroughCtx = createContext(null);

export function useWalkthrough() {
  const ctx = useContext(WalkthroughCtx);
  if (!ctx) throw new Error('useWalkthrough must be used within WalkthroughProvider');
  return ctx;
}

export function WalkthroughProvider({ children }) {
  const { user } = useAuth();
  const K = useKettle();
  const M = usePrivate();
  const navigate = useNavigate();
  const location = useLocation();

  const [stepId, setStepId] = useState(null);
  const targetsRef = useRef({});
  const [targetsVersion, bumpTargets] = useState(0);

  /* A stable (memoized-per-key) ref callback. Screens use `W.targetRef(key)`
     as a `ref` prop directly — if this returned a fresh function on every
     render instead, React would treat it as a changed ref and re-invoke it
     each render, and since registering a target changes context value (which
     re-renders the very component holding the ref), that becomes an infinite
     render loop. */
  const refCacheRef = useRef({});
  const targetRef = useCallback((key) => {
    if (!refCacheRef.current[key]) {
      refCacheRef.current[key] = (el) => {
        targetsRef.current[key] = el;
        bumpTargets((n) => n + 1);
      };
    }
    return refCacheRef.current[key];
  }, []);

  const step = stepId ? STEPS[stepId] : null;
  const active = !!step;
  const stepIndex = active ? ORDER.indexOf(stepId) : -1;

  /* The next step to actually show: ones already done are passed over
     straight away, so a household that's set up doesn't watch the tour
     flick through screens it has no need of. */
  const resolve = useCallback((id) => {
    let nextId = id;
    for (let guard = 0; nextId && guard < ORDER.length; guard++) {
      const s = STEPS[nextId];
      if (!s?.doneWhen || !s.doneWhen(K, M)) break;
      nextId = typeof s.next === 'function' ? s.next(K, M) : s.next;
    }
    return nextId || null;
  }, [K, M]);

  const advance = useCallback((fromId) => {
    const current = STEPS[fromId];
    if (!current) return;
    const nextId = typeof current.next === 'function' ? current.next(K, M) : current.next;
    setStepId(resolve(nextId));
  }, [K, M, resolve]);

  const next = useCallback(() => {
    if (stepId) advance(stepId);
  }, [stepId, advance]);

  const skip = useCallback(() => {
    setStepId(null);
    if (user) markSeen(user.id);
  }, [user]);

  const restart = useCallback(() => {
    setStepId('welcome');
  }, []);

  /* Auto-start once, for a brand-new household, after the first sign-in —
     but only once the household has really loaded (until then it looks
     empty, which used to start the tour for households with bills), and
     only inside the app itself, never over setup, admin or sign-in. */
  // Not before the first-run welcome is done either: it runs first, and
  // ends by offering the tour itself.
  const householdLoaded = !K.loading && !!K.data.household?.id && !M.loading && K.you?.firstRunDone !== false;
  const inApp = location.pathname.startsWith('/android/') && location.pathname !== '/android/onboarding';
  useEffect(() => {
    if (!user || !householdLoaded || !inApp || active) return;
    if (hasSeen(user.id)) return;
    markSeen(user.id);
    if (K.data.bills.length > 0 || K.data.lending.length > 0) return;
    setStepId('welcome');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, householdLoaded, inApp]);

  /* Keep the browser on whichever screen the active step belongs to. */
  useEffect(() => {
    if (!step) return;
    if (location.pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  /* Auto-advance the moment the person actually completes the current
     step's real action (steps already done are skipped by resolve()). */
  useEffect(() => {
    if (!step || !step.doneWhen) return;
    if (step.doneWhen(K, M)) {
      const t = setTimeout(() => advance(stepId), 500);
      return () => clearTimeout(t);
    }
  }, [step, stepId, K, M, advance]);

  const value = useMemo(() => ({
    active, step, stepIndex, totalSteps: ORDER.length,
    targets: targetsRef.current, targetRef, next, skip, restart
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetsVersion is a bump signal, not read directly
  }), [active, step, stepIndex, targetRef, next, skip, restart, targetsVersion]);

  return <WalkthroughCtx.Provider value={value}>{children}</WalkthroughCtx.Provider>;
}
