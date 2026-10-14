import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { api, serverSendsEmail } from '../lib/api';
import { isRecoverableAuthError } from '../lib/authRetry';
import { registerForPush, unregisterPush } from '../lib/push';

const AuthCtx = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/* Native only: an email link (password reset) can't redirect to the app's
   internal https://localhost origin — that address only exists inside the
   app's own WebView. ktl://auth/callback is registered as an intent filter
   in AndroidManifest.xml instead, so tapping the link opens the app, and
   the server allows it as a redirect target. */
const NATIVE_AUTH_REDIRECT = 'ktl://auth/callback';

/* A password-reset link lands with `type=recovery` in the URL fragment.
   Read it as the module loads — before the auth client consumes the
   fragment and fires PASSWORD_RECOVERY, which can happen before any
   listener is attached — so the app still knows to ask for a new password. */
const RECOVERY_IN_URL = typeof window !== 'undefined' && /(^|[#&])type=recovery(&|$)/.test(window.location.hash || '');

/* Where a reset email, or a reset link from whoever runs the server,
   sends the person back to. */
function authRedirect() {
  return Capacitor.isNativePlatform() ? NATIVE_AUTH_REDIRECT : `${window.location.origin}/android/home`;
}

/* The one-time code (and its flow id) from a ktl://auth/callback link.
   Raw tokens in a link are never accepted: anything could send the app a
   ktl:// link, and taking a session from one would sign this phone into
   whoever's account the sender chose. */
export function codeFromCallback(url) {
  if (!url || !url.startsWith(NATIVE_AUTH_REDIRECT)) return null;
  try {
    const params = new URL(url).searchParams;
    const code = params.get('code');
    return code ? { code, flowId: params.get('sb_flow_id') || undefined } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(RECOVERY_IN_URL);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  // Set the moment a real auth event arrives, so boot()'s retry loop —
  // which can still be in flight seconds later — knows not to stomp a
  // fresher session with whatever stale result it was chasing.
  const liveEventSeenRef = useRef(false);

  useEffect(() => {
    async function boot() {
      /* A cold boot's very first getSession() can hit "JWT issued at
         future" — a few seconds of clock skew between the device and the
         server, which resolves itself. KettleContext and PrivateContext
         retry this on their own boots too, but they only run once THIS
         provider has decided who's signed in; taking the error at face
         value here would drop a perfectly valid person to the sign-in
         screen before either retry got a chance. */
      let data = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await api.auth.getSession();
        if (!result.error || attempt === 2 || !isRecoverableAuthError(result.error)) {
          data = result.data;
          break;
        }
        try { await api.auth.refreshSession(); } catch { /* keep the old token and retry anyway */ }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }

      try {
        if (liveEventSeenRef.current) return; // a real event already decided this — don't overwrite it
        setSession(data.session);
      } finally {
        // Always ends loading, even when a live event beat this to the
        // session itself — either way, auth state is now known.
        setLoading(false);
      }
    }
    boot();

    const { data: sub } = api.auth.onAuthStateChange((event, next) => {
      liveEventSeenRef.current = true;
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      /* A null session here is not always a real sign-out. When a token
         refresh fails — most often the flaky network right after the app
         resumes — the client reports no session even though valid tokens
         are still sitting in storage. Treating that as a sign-out wipes
         every provider's state (income, personal bills, debts all revert
         to empty defaults). So: trust an explicit SIGNED_OUT, and for any
         other event re-check storage before tearing anything down. */
      if (!next && event !== 'SIGNED_OUT') {
        api.auth.getSession().then(({ data }) => {
          if (data.session) return; // transient — keep the session we already have
          setSession(null);
        });
        return;
      }
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* Cold-started deep links are flaky in two specific ways this effect
     works around:
       1. The OS can deliver the launch URL before appUrlOpen has any
          listener to catch it. getLaunchUrl() reads that same URL
          directly, independent of event timing.
       2. Right after a cold start, the WebView's network stack can still
          be waking up when setSession's validation request fires, and
          that request silently stalls. Backgrounding and re-opening the
          app un-sticks it, which is what "resume" does below: re-run
          getSession() so a session that already made it into storage gets
          picked up even if the original call hung. */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    function applyUrl(url) {
      const found = codeFromCallback(url);
      if (!found) return;
      // Swapped for a session only with the secret this app kept when it
      // asked for the email; a reset link also fires PASSWORD_RECOVERY,
      // which asks for the new password.
      api.auth.exchangeCodeForSession(found.code, found.flowId ? { flowId: found.flowId } : undefined)
        .then(({ error }) => { if (error) console.error('That sign-in link couldn’t be used', error.message); })
        .catch((err) => console.error('That sign-in link couldn’t be used', err));
    }

    CapApp.getLaunchUrl().then((result) => applyUrl(result?.url));
    const urlListener = CapApp.addListener('appUrlOpen', ({ url }) => applyUrl(url));
    const resumeListener = CapApp.addListener('resume', () => {
      if (sessionRef.current) return;
      api.auth.getSession().then(({ data }) => setSession(data.session));
    });

    return () => {
      urlListener.then((l) => l.remove());
      resumeListener.then((l) => l.remove());
    };
  }, []);

  /* Email + password. The server doesn't ask new accounts to confirm their
     address (there may be no mail server at all), so signUp hands back a
     live session straight away; if one ever does, it returns none and the
     caller tells the person to check their inbox. */
  const signUp = useCallback(async (email, password, fullName) => {
    const { data, error } = await api.auth.signUp({
      email,
      password,
      options: { data: fullName ? { full_name: fullName } : undefined, emailRedirectTo: authRedirect() }
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { error } = await api.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    const { error } = await api.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
    if (error) throw error;
  }, []);

  /* Finishes a reset link, and changes a password from settings — either
     way the person is already signed in. */
  const updatePassword = useCallback(async (password) => {
    const { error } = await api.auth.updateUser({ password });
    if (error) throw error;
    setRecovering(false);
  }, []);

  const finishRecovery = useCallback(() => setRecovering(false), []);

  const signOut = useCallback(() => api.auth.signOut(), []);

  /* The auth client hands back a brand-new session object on every token
     refresh (roughly hourly, and again on each resume). Passing
     `session.user` straight through would change identity constantly, and
     every consumer keying an effect on `user` would refetch all their data
     each time. The signed-in person only meaningfully changes when the id
     does, so pin the reference to that. */
  const userId = session?.user?.id ?? null;
  const user = useMemo(
    () => session?.user ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId]
  );

  /* Register this device for push once someone is actually signed in, and
     drop it again on sign-out — keyed on the id, so a token refresh
     doesn't churn it. */
  useEffect(() => {
    if (!userId) {
      unregisterPush().catch(() => {});
      return;
    }
    registerForPush(userId).catch((err) => console.error('Push setup failed', err));
  }, [userId]);

  const value = useMemo(() => ({
    session,
    user,
    loading,
    recovering,
    signUp,
    signIn,
    requestPasswordReset,
    updatePassword,
    finishRecovery,
    serverSendsEmail,
    signOut
  }), [session, user, loading, recovering, signUp, signIn, requestPasswordReset, updatePassword, finishRecovery, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
