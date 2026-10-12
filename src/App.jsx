import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Style, StatusBar } from '@capacitor/status-bar';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { KettleProvider, useKettle } from './context/KettleContext';
import { PrivateProvider, usePrivate } from './context/PrivateContext';
import { WalkthroughProvider } from './context/WalkthroughContext';
import WalkthroughOverlay from './components/WalkthroughOverlay';
import LoadingScreen from './components/LoadingScreen';
import AndroidOnboarding, { SetPasswordScreen } from './screens/android/Onboarding';
import { hasServer, SERVER_URL } from './lib/api';
import Connect from './screens/Connect';
import Setup from './screens/Setup';
import Admin from './screens/Admin';
import AndroidHome from './screens/android/Home';
import AndroidBills from './screens/android/Bills';
import AndroidSettle from './screens/android/Settle';
import AndroidHousehold from './screens/android/Household';
import AndroidAlerts from './screens/android/Alerts';
import AndroidYours from './screens/android/Yours';

function BootErrorScreen({ error }) {
  /* Nothing internal reaches the screen. "JWT issued at future" or a
     constraint name tells someone nothing they can act on, and reads as
     the app being broken rather than momentarily stuck. The one exception
     is connectivity, because that IS actionable — turn your wifi back on.
     The real message still goes to the console for debugging. */
  const raw = error?.message || '';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const looksNetworky = /failed to fetch|networkerror|network request|err_internet|timeout|unreachable/i.test(raw);
  const isConnectivity = offline || looksNetworky;

  if (raw) console.error('Boot failed:', error);

  /* The two states that aren't faults: the server's household hasn't been
     created yet, or it already has everyone it can hold. */
  const known = {
    no_household_yet: ['This server isn’t set up yet.', `Whoever runs it can finish at ${SERVER_URL}/setup, then try again.`],
    household_full: ['This household is full.', 'It already has six people, the most KTL allows. Whoever runs the server can remove someone to make room.']
  }[error?.code];
  const [title, detail] = known || (isConnectivity
    ? ['No connection.', 'Check your internet connection and try again.']
    : ['Something went wrong.', 'Please try again.']);

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--fg)', padding: 'var(--space-6)', textAlign: 'center' }}>
      <div style={{ maxWidth: '38ch' }}>
        <p style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>{title}</p>
        <p className="meta" style={{ marginBottom: 'var(--space-4)' }}>{detail}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </div>
  );
}

/* Every screen but onboarding and setup needs a session. Logging in from
   here comes back to where you were headed (the admin page, say). */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen label="Signing you in" />;
  if (!user) return <Navigate to="/android/onboarding" replace state={{ from: location.pathname }} />;
  return children;
}

/* Once signed in, the onboarding flow itself just moves on. */
function RedirectIfSignedIn({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen label="Signing you in" />;
  if (user) return <Navigate to={location.state?.from || '/android/home'} replace />;
  return children;
}

/* KettleContext's household bootstrap (create/find + fetch) runs async
   after sign-in — hold the screen until it settles so nothing renders
   against a still-empty `you`/`data`. */
function WaitForHousehold({ children }) {
  const { loading, error } = useKettle();
  if (loading) return <LoadingScreen label="Loading your household" />;
  if (error) return <BootErrorScreen error={error} />;
  return children;
}

/* Same idea as WaitForHousehold, for the one screen that reads
   PrivateContext (Yours.jsx never checked M.loading/M.error itself — see
   PrivateContext.jsx's boot-retry comment). Without this, an exhausted
   retry after a real network failure showed the empty DEFAULT_SETTINGS
   silently: zero income, no debts, no personal bills — indistinguishable
   from an actual wipe rather than a load that failed. */
function WaitForPrivate({ children }) {
  const { loading, error } = usePrivate();
  if (loading) return <LoadingScreen label="Loading your figures" />;
  if (error) return <BootErrorScreen error={error} />;
  return children;
}

function protectedRoute(element, { needsPrivate } = {}) {
  const gated = needsPrivate ? <WaitForPrivate>{element}</WaitForPrivate> : element;
  return (
    <RequireAuth>
      <WaitForHousehold>{gated}</WaitForHousehold>
    </RequireAuth>
  );
}

function AppRoutes() {
  const { user, recovering } = useAuth();
  // A reset link has just signed this person in: get a password first.
  if (recovering && user) return <SetPasswordScreen />;
  return (
    <WalkthroughProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/android/onboarding" replace />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/android/onboarding" element={<RedirectIfSignedIn><AndroidOnboarding /></RedirectIfSignedIn>} />
        <Route path="/android/home" element={protectedRoute(<AndroidHome />)} />
        <Route path="/android/bills" element={protectedRoute(<AndroidBills />)} />
        <Route path="/android/settle" element={protectedRoute(<AndroidSettle />)} />
        <Route path="/android/household" element={protectedRoute(<AndroidHousehold />)} />
        <Route path="/android/alerts" element={protectedRoute(<AndroidAlerts />)} />
        <Route path="/android/yours" element={protectedRoute(<AndroidYours />, { needsPrivate: true })} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <WalkthroughOverlay />
    </WalkthroughProvider>
  );
}

/* On-device, show the OS's real status bar styled to match the app. */
function useNativeStatusBar() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.show().catch(() => {});
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#fbf6ee' }).catch(() => {});
  }, []);
}

export default function App() {
  useNativeStatusBar();
  // The Android app has to be told which server to use before anything
  // else can run; the web app always uses the server that served it.
  if (!hasServer()) return <Connect />;
  return (
    <AuthProvider>
      <KettleProvider>
        <PrivateProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </PrivateProvider>
      </KettleProvider>
    </AuthProvider>
  );
}
