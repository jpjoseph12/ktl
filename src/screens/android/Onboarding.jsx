import { useState } from 'react';
import { Link } from 'react-router-dom';
import PhoneShell from '../../components/PhoneShell';
import Icon from '../../components/Icon';
import { useAuth } from '../../context/AuthContext';
import { MIN_PASSWORD_LENGTH, validEmail, validName, validPassword } from '../../lib/validation';
import { TabletCenteredShell } from '../../components/tablet/TabletShell';
import useIsTablet, { CENTERED_QUERY } from '../../lib/useIsTablet';
import useServerInfo from '../../lib/useServerInfo';
import { accountNeedsPassword, clearServer, IS_NATIVE, SERVER_URL } from '../../lib/api';


function OnboardingFrame({ children }) {
  const wide = useIsTablet(CENTERED_QUERY);
  if (wide) return <TabletCenteredShell platform="android">{children}</TabletCenteredShell>;
  return <PhoneShell platform="android">{children}</PhoneShell>;
}

export default function AndroidOnboarding() {
  return (
    <OnboardingFrame>
      <OnboardingBody />
    </OnboardingFrame>
  );
}

/* welcome / signin / nopassword / forgot / sent are the chrome-less splash screens —
   no app bar, matching the source design. signup is the multi-field
   "create your account" screen, which keeps its own app bar. */
const STEP_TITLE = {
  signup: 'Create your account'
};

/* GoTrue's error codes, in words someone can act on. Anything else falls
   back to the server's own message. */
export function authMessage(err, fallback) {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'That email and password don’t match.';
    case 'user_already_exists':
    case 'email_exists':
      return 'There’s already an account with that email. Log in instead.';
    case 'weak_password':
      return `Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`;
    case 'signup_disabled':
      return 'New accounts are switched off on this server. Ask whoever runs it to add you.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many tries. Wait a minute, then try again.';
    default:
      return err?.message || fallback;
  }
}

/* For the person who runs the server, who has nobody to ask: set it from
   the server itself. */
function OwnerReset() {
  return (
    <div className="hint splash-form">
      <Icon name="settings" size={16} />
      <span>
        <strong>Run this server yourself?</strong> Open its console (in Unraid: Docker → ktl → Console) and run{' '}
        <code>ktl-admin set-password you@example.com</code> with your email — it asks for the new password. From a terminal,
        put <code>docker exec -it ktl</code> in front.
      </span>
    </div>
  );
}

export function PasswordField({ id, label, value, onChange, invalid, help, autoComplete }) {
  const [shown, setShown] = useState(false);
  return (
    <div className={'field' + (invalid ? ' invalid' : '')}>
      <label htmlFor={id}>{label}</label>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <input
          className="input grow" id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete}
          autoCapitalize="off" spellCheck="false" value={value} onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {help && <span className="field-help">{help}</span>}
      <span className="field-error">Use at least {MIN_PASSWORD_LENGTH} characters.</span>
    </div>
  );
}

function OnboardingBody() {
  const { signUp, signIn, requestPasswordReset, serverSendsEmail } = useAuth();
  const server = useServerInfo();
  const [step, setStep] = useState('welcome');
  const [sentReason, setSentReason] = useState('reset');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [canEmail, setCanEmail] = useState(true);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [passwordInvalid, setPasswordInvalid] = useState(false);

  function go(next) {
    setFormError('');
    setPasswordInvalid(false);
    setStep(next);
  }

  function changeServer() {
    clearServer();
    window.location.reload();
  }

  function back() {
    go(step === 'forgot' || step === 'nopassword' ? 'signin' : 'welcome');
  }

  async function submitSignup() {
    const okName = validName(fullName);
    const okEmail = validEmail(email);
    const okPassword = validPassword(password);
    setNameInvalid(!okName);
    setEmailInvalid(!okEmail);
    setPasswordInvalid(!okPassword);
    if (!okName || !okEmail || !okPassword) return;

    setFormError('');
    setBusy(true);
    try {
      const { needsConfirmation } = await signUp(email.trim(), password, fullName.trim());
      // Otherwise the new session takes over and the router moves on.
      if (needsConfirmation) {
        setSentReason('confirm');
        setStep('sent');
      }
    } catch (err) {
      setFormError(authMessage(err, 'Could not create your account.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitSignin() {
    if (!validEmail(email) || !password) return;
    setFormError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      // "Wrong password" is misleading for an account that has none yet.
      if (err?.code === 'invalid_credentials' && await accountNeedsPassword(email.trim())) {
        setCanEmail(await serverSendsEmail());
        go('nopassword');
        return;
      }
      setFormError(authMessage(err, 'Could not log you in.'));
    } finally {
      setBusy(false);
    }
  }

  async function openForgot() {
    go('forgot');
    setCanEmail(await serverSendsEmail());
  }

  async function submitForgot(reason = 'reset') {
    if (!validEmail(email)) return;
    setFormError('');
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSentReason(reason);
      setStep('sent');
    } catch (err) {
      setFormError(authMessage(err, 'Could not send a reset link.'));
    } finally {
      setBusy(false);
    }
  }

  const showAppBar = step === 'signup';

  return (
    <>

      {showAppBar && (
        <header className="md-appbar">
          <button className="md-iconbtn" aria-label="Back" onClick={back}>
            <Icon name="back" size={22} />
          </button>
          <span className="appbar-title">{STEP_TITLE[step]}</span>
          <span className="md-iconbtn" aria-hidden="true" />
        </header>
      )}

      <main className={showAppBar ? 'scroll' : 'splash-main'}>
        {step === 'welcome' && (
          <section className="splash-panel">
            <div className="splash-brand">
              <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
              <h1 className="splash-wordmark">KTL</h1>
              <p className="splash-tagline">Split the shared bills. Keep your own numbers to yourself.</p>
            </div>

            {server?.ready === false ? (
              <div className="splash-form stack">
                <p className="hint">
                  <Icon name="settings" size={16} />
                  <span>This server isn’t set up yet.{IS_NATIVE && <> Finish setting it up in a browser at <strong>{SERVER_URL}/setup</strong>.</>}</span>
                </p>
                {!IS_NATIVE && <Link className="btn btn-primary btn-block" to="/setup">Set up this server</Link>}
              </div>
            ) : (
              <div className="splash-form stack">
                {server?.signup === false ? (
                  <>
                    <button className="btn btn-primary btn-block" onClick={() => go('signin')}>Log in</button>
                    <p className="meta splash-shortcut">New here? Ask whoever runs this server to add you.</p>
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary btn-block" onClick={() => go('signup')}>Sign up</button>
                    <p className="meta splash-shortcut">
                      Already have an account? <button type="button" onClick={() => go('signin')}>Log in</button>
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="meta splash-shortcut">
              {new URL(SERVER_URL).host}
              {IS_NATIVE && <> · <button type="button" onClick={changeServer}>Change server</button></>}
            </p>
          </section>
        )}

        {step === 'signin' && (
          <section className="splash-panel">
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingInline: 'var(--space-2)' }} onClick={back}>
              <Icon name="back" size={18} />Back
            </button>

            <div className="splash-brand" style={{ paddingTop: 'var(--space-4)' }}>
              <h1 className="splash-wordmark">Log in</h1>
              <p className="splash-tagline">Enter the email your household uses on KTL.</p>
            </div>

            <form className="splash-form stack" onSubmit={(e) => { e.preventDefault(); submitSignin(); }}>
              <div className={'field' + (emailInvalid ? ' invalid' : '')}>
                <label htmlFor="signin-email">Email</label>
                <input
                  className="input" id="signin-email" type="email" placeholder="you@example.com"
                  autoComplete="email" autoCapitalize="off" spellCheck="false"
                  value={email} onChange={(e) => { setEmail(e.target.value); setEmailInvalid(false); }}
                />
              </div>
              <PasswordField id="signin-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
              {formError && (
                <p className="hint">
                  <Icon name="alert" size={16} />
                  <span>{formError}</span>
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-block" disabled={!validEmail(email) || !password || busy}>
                {busy ? 'Logging in…' : 'Log in'}
              </button>
              <p className="meta splash-shortcut">
                <button type="button" onClick={openForgot}>Forgot your password?</button>
              </p>
            </form>
          </section>
        )}

        {step === 'nopassword' && (
          <section className="splash-panel">
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingInline: 'var(--space-2)' }} onClick={back}>
              <Icon name="back" size={18} />Back
            </button>

            <div className="splash-brand" style={{ paddingTop: 'var(--space-4)' }}>
              <h1 className="splash-wordmark">Set your password</h1>
              <p className="splash-tagline">
                It looks like there isn’t a password set for <strong className="num">{email.trim()}</strong> yet. Please set one, then log in with it.
              </p>
            </div>

            <div className="splash-form stack">
              {canEmail ? (
                <>
                  {formError && <p className="hint"><Icon name="alert" size={16} /><span>{formError}</span></p>}
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={() => submitForgot('set')}>
                    {busy ? 'Sending…' : 'Email me a link to set it'}
                  </button>
                </>
              ) : (
                <p className="hint">
                  <Icon name="lock" size={16} />
                  <span>This server can’t send email, so ask whoever runs it for a set-password link — they can make one under People and server settings. It opens straight to a screen where you choose your password.</span>
                </p>
              )}
              {!canEmail && <OwnerReset />}
              <button className="btn btn-ghost btn-block" onClick={() => go('signin')}>Back to log in</button>
            </div>
          </section>
        )}

        {step === 'forgot' && (
          <section className="splash-panel">
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingInline: 'var(--space-2)' }} onClick={back}>
              <Icon name="back" size={18} />Back
            </button>

            <div className="splash-brand" style={{ paddingTop: 'var(--space-4)' }}>
              <h1 className="splash-wordmark">Set a new password</h1>
              <p className="splash-tagline">
                {canEmail
                  ? 'We’ll email you a link to choose a new one.'
                  : 'This KTL server can’t send email, so ask whoever runs it for a reset link. It opens straight to a new-password screen.'}
              </p>
            </div>

            {!canEmail && <OwnerReset />}

            {canEmail && (
              <form className="splash-form stack" onSubmit={(e) => { e.preventDefault(); submitForgot(); }}>
                <div className="field">
                  <label htmlFor="forgot-email">Email</label>
                  <input
                    className="input" id="forgot-email" type="email" placeholder="you@example.com"
                    autoComplete="email" autoCapitalize="off" spellCheck="false"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {formError && <p className="hint"><Icon name="alert" size={16} /><span>{formError}</span></p>}
                <button type="submit" className="btn btn-primary btn-block" disabled={!validEmail(email) || busy}>
                  {busy ? 'Sending…' : 'Email me a reset link'}
                </button>
              </form>
            )}
          </section>
        )}

        {step === 'signup' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submitSignup(); }}>
            <p className="body-sm">Just enough to set up your account and keep it yours.</p>

            <div className={'field' + (nameInvalid ? ' invalid' : '')}>
              <label htmlFor="ob-name">Full name</label>
              <input
                className="input" id="ob-name" type="text" placeholder="e.g. Jordan Doyle" autoComplete="name"
                value={fullName} onChange={(e) => setFullName(e.target.value)}
              />
              <span className="field-error">Enter the name you’d like your household to see.</span>
            </div>

            <div className={'field' + (emailInvalid ? ' invalid' : '')}>
              <label htmlFor="ob-email">Email address</label>
              <input
                className="input" id="ob-email" type="email" inputMode="email" placeholder="you@example.com"
                autoComplete="email" autoCapitalize="off" spellCheck="false"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
              <span className="field-help">You’ll log in with this.</span>
              <span className="field-error">Enter a valid email address.</span>
            </div>

            <PasswordField
              id="ob-password" label="Password" value={password} onChange={setPassword} invalid={passwordInvalid}
              autoComplete="new-password" help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            />

            <p className="hint">
              <Icon name="lock" size={16} />
              <span>
                Your name and email are only ever used to verify it’s you and keep your account secure — never for
                marketing, and never shared or sold to anyone.
              </span>
            </p>

            {formError && (
              <p className="hint"><Icon name="alert" size={16} /><span>{formError}</span></p>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account'}
            </button>
          </form>
        )}

        {step === 'sent' && (
          <section className="splash-panel" style={{ alignItems: 'center', textAlign: 'center', gap: 'var(--space-3)' }}>
            <div style={{ paddingTop: 'var(--space-8)' }}>
              <Icon name="send" size={26} />
              <h1 style={{ marginTop: 'var(--space-3)' }}>Check your email</h1>
              <p className="body-sm" style={{ marginTop: 'var(--space-2)' }}>
                {sentReason === 'set'
                  ? <>We’ve sent a link to <strong className="num">{email}</strong>. Open it to choose your password, and you’re in.</>
                  : sentReason === 'reset'
                  ? <>If there’s an account for <strong className="num">{email}</strong>, we’ve sent it a link to set a new password.</>
                  : <>We sent a link to <strong className="num">{email}</strong>. Open it to confirm your address, then log in.</>}
              </p>
            </div>

            <div className="splash-form stack" style={{ width: '100%' }}>
              <button className="btn btn-ghost btn-block" onClick={() => go('signin')}>Back to log in</button>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

/* Shown over everything after a password-reset link signs someone in —
   the link alone mustn't leave them with no password they know. */
export function SetPasswordScreen() {
  const { updatePassword, finishRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function submit() {
    const ok = validPassword(password);
    setInvalid(!ok);
    if (!ok) return;
    setFormError('');
    setBusy(true);
    try {
      await updatePassword(password);
    } catch (err) {
      setFormError(authMessage(err, 'Could not save your new password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingFrame>
      <main className="splash-main">
        <section className="splash-panel">
          <div className="splash-brand" style={{ paddingTop: 'var(--space-8)' }}>
            <h1 className="splash-wordmark">Choose a password</h1>
            <p className="splash-tagline">You’ll use it with your email to log in from now on.</p>
          </div>
          <form className="splash-form stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <PasswordField
              id="new-password" label="New password" value={password} onChange={setPassword} invalid={invalid}
              autoComplete="new-password" help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            />
            {formError && <p className="hint"><Icon name="alert" size={16} /><span>{formError}</span></p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={finishRecovery}>Not now</button>
          </form>
        </section>
      </main>
    </OnboardingFrame>
  );
}
