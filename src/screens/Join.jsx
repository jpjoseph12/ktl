import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import PhoneShell from '../components/PhoneShell';
import { TabletCenteredShell } from '../components/tablet/TabletShell';
import { useAuth } from '../context/AuthContext';
import useIsTablet, { CENTERED_QUERY } from '../lib/useIsTablet';
import { fetchServerInfo, IS_NATIVE, SERVER_URL, setServer } from '../lib/api';
import { appInviteLink, checkInvite, clearPendingInvite, readPendingInvite, redeemInvite, tokenFromHash } from '../lib/invite';
import { MIN_PASSWORD_LENGTH, validPassword } from '../lib/validation';
import { PasswordField, authMessage } from './android/Onboarding';

const RELEASES = 'https://github.com/jpjoseph12/ktl/releases/latest';

const STATE_MESSAGE = {
  used: ['This invite has been used', 'Each invite works once. If you’ve already chosen a password, log in. If that wasn’t you, tell whoever runs this server.'],
  expired: ['This invite has run out', 'Ask whoever invited you for a new one.'],
  cancelled: ['This invite was replaced', 'A newer invite was made for you — use that one, or ask for a new one.'],
  missing: ['This invite isn’t right', 'The link may be incomplete. Open it again from the message, or ask for a new one.']
};

function Frame({ children }) {
  const wide = useIsTablet(CENTERED_QUERY);
  const body = <main className="splash-main"><section className="splash-panel">{children}</section></main>;
  return wide ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell> : <PhoneShell platform="android">{body}</PhoneShell>;
}

function Brand({ title, tagline }) {
  return (
    <div className="splash-brand">
      <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
      <h1 className="splash-wordmark">{title}</h1>
      {tagline && <p className="splash-tagline">{tagline}</p>}
    </div>
  );
}

const onAndroidBrowser = () => !IS_NATIVE && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');

/* /join#<token>: someone the owner added chooses their password and is in.
   Opened in a browser from the invite message, or inside the app after a
   ktl://join link or a pasted invite. */
export default function Join() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(window.location.hash) || readPendingInvite()?.token || '');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Keep the token out of the address bar (and history) once read.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) { setInfo({ valid: false, state: 'missing' }); return; }
    checkInvite(SERVER_URL, token).then(setInfo).catch((err) => setError(err.message));
  }, [token]);

  async function join() {
    if (!validPassword(password)) { setInvalid(true); return; }
    setError('');
    setBusy(true);
    try {
      const { email } = await redeemInvite(SERVER_URL, token, password);
      clearPendingInvite();
      await signIn(email, password);
      navigate('/android/home', { replace: true });
    } catch (err) {
      if (err.status === 410) { setInfo({ valid: false, state: err.code === 'invite_used' ? 'used' : 'expired' }); return; }
      setError(authMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <Frame>
        <Brand title="KTL" tagline="Couldn’t check your invite." />
        <div className="splash-form stack">
          <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>
          <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>Try again</button>
        </div>
      </Frame>
    );
  }

  if (!info) {
    return <Frame><Brand title="KTL" tagline="Checking your invite…" /></Frame>;
  }

  if (!info.valid) {
    const [title, detail] = STATE_MESSAGE[info.state] || STATE_MESSAGE.missing;
    return (
      <Frame>
        <Brand title={title} tagline={detail} />
        <div className="splash-form stack">
          <Link className="btn btn-primary btn-block" to="/android/onboarding" onClick={clearPendingInvite}>Log in</Link>
        </div>
      </Frame>
    );
  }

  if (user && user.email?.toLowerCase() !== info.email?.toLowerCase()) {
    return (
      <Frame>
        <Brand title="Join KTL" tagline={`This invite is for ${info.email}, but you’re logged in as ${user.email}.`} />
        <div className="splash-form stack">
          <button className="btn btn-primary btn-block" onClick={() => signOut()}>Log out to accept it</button>
          <Link className="btn btn-ghost btn-block" to="/android/home" onClick={clearPendingInvite}>Keep using {user.email}</Link>
        </div>
      </Frame>
    );
  }

  const who = info.owner ? `${info.owner} has invited you` : 'You’re invited';
  return (
    <Frame>
      <Brand title={`Join ${info.household || 'the household'}`} tagline={`${who} to share the household bills on KTL. Choose a password to finish.`} />

      {onAndroidBrowser() && (
        <div className="stack-sm">
          <a className="btn btn-secondary btn-block" href={appInviteLink(SERVER_URL, token)}><Icon name="phone" size={16} />Open in the KTL app</a>
          <a className="meta splash-shortcut" href={RELEASES}>Don’t have the app? Get it here</a>
        </div>
      )}

      <form className="splash-form stack" onSubmit={(e) => { e.preventDefault(); if (!busy) join(); }}>
        <div className="field">
          <label htmlFor="join-email">Email</label>
          <input className="input" id="join-email" type="email" value={info.email} readOnly autoComplete="username" />
          <span className="field-help">You’ll log in with this.</span>
        </div>
        <PasswordField
          id="join-password" label="Choose a password" value={password} invalid={invalid}
          onChange={(v) => { setPassword(v); setInvalid(false); }} autoComplete="new-password"
          help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>
          {busy ? 'Joining…' : 'Join'}
        </button>
        <p className="meta splash-shortcut">This invite works once, until {new Date(info.expiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>
      </form>
    </Frame>
  );
}

/* In the app: a ktl://connect link (from a server's /get page) for a
   server this app isn't on. Says where it leads, then switches. */
export function ServerSwitch({ server, onCancel }) {
  const host = (() => { try { return new URL(server).host; } catch { return server; } })();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError('');
    try {
      const info = await fetchServerInfo(server);
      setServer(info.url);
      window.location.replace('/android/onboarding');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Frame>
      <Brand title="Connect to KTL" tagline={`Use the KTL server at ${host}?`} />
      <div className="splash-form stack">
        {SERVER_URL && <p className="meta">This app is connected to {new URL(SERVER_URL).host}. Connecting switches it to {host}.</p>}
        {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
        <button className="btn btn-primary btn-block" disabled={busy} onClick={go}>{busy ? 'Checking…' : 'Connect'}</button>
        <button className="btn btn-ghost btn-block" onClick={onCancel}>Not now</button>
      </div>
    </Frame>
  );
}

/* In the app, before anything else: an invite for a server this app isn't
   connected to. Says where it leads, then switches and restarts. */
export function InviteSwitch({ invite, onCancel }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const host = (() => { try { return new URL(invite.server).host; } catch { return invite.server; } })();

  useEffect(() => {
    checkInvite(invite.server, invite.token).then(setInfo).catch((err) => setError(err.message));
  }, [invite.server, invite.token]);

  function go() {
    setServer(invite.server);
    window.location.replace('/join');
  }

  return (
    <Frame>
      <Brand
        title={info?.valid ? `Join ${info.household || 'a household'}` : 'An invite to KTL'}
        tagline={info?.valid
          ? `${info.owner ? `${info.owner} has invited you` : 'You’re invited'} to share the household bills, on the KTL server at ${host}.`
          : `It’s for the KTL server at ${host}.`}
      />
      <div className="splash-form stack">
        {error && <p className="hint"><Icon name="alert" size={16} /><span>Couldn’t reach {host}: {error}</span></p>}
        {info && !info.valid && <p className="hint"><Icon name="alert" size={16} /><span>{(STATE_MESSAGE[info.state] || STATE_MESSAGE.missing).join('. ')}</span></p>}
        {SERVER_URL && <p className="meta">This app is connected to {new URL(SERVER_URL).host}. Joining switches it to {host}.</p>}
        <button className="btn btn-primary btn-block" disabled={!info?.valid} onClick={go}>Continue</button>
        <button className="btn btn-ghost btn-block" onClick={onCancel}>Not now</button>
      </div>
    </Frame>
  );
}
