import { useState } from 'react';
import Icon from '../components/Icon';
import PhoneShell from '../components/PhoneShell';
import { TabletCenteredShell } from '../components/tablet/TabletShell';
import useIsTablet, { CENTERED_QUERY } from '../lib/useIsTablet';
import { fetchServerInfo, normaliseServerUrl, setServer } from '../lib/api';
import { parseInvite, savePendingInvite } from '../lib/invite';

/* The Android app's first screen: which KTL server to use. KTL is
   self-hosted, so the app can't know where yours lives until you say.
   The address is checked against the server's own /api/config before it's
   saved, then the app restarts against it. */
export default function Connect({ onConnected = () => window.location.reload() }) {
  const wide = useIsTablet(CENTERED_QUERY);
  const body = <ConnectBody onConnected={onConnected} />;
  return wide ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell> : <PhoneShell platform="android">{body}</PhoneShell>;
}

function ConnectBody({ onConnected }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    setBusy(true);
    try {
      // A pasted invite (the link, or the whole message) brings its server.
      const invite = parseInvite(address);
      const info = await fetchServerInfo(invite ? invite.server : address);
      setServer(info.url);
      if (invite) {
        savePendingInvite({ server: info.url, token: invite.token });
        window.location.replace('/join');
        return;
      }
      onConnected(info);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="splash-main">
      <section className="splash-panel">
        <div className="splash-brand">
          <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
          <h1 className="splash-wordmark">KTL</h1>
          <p className="splash-tagline">Your household’s KTL runs on its own server. Enter its address to connect.</p>
        </div>

        <form className="splash-form stack" onSubmit={(e) => { e.preventDefault(); if (!busy) connect(); }}>
          <div className="field">
            <label htmlFor="server-address">Server address</label>
            <input
              className="input" id="server-address" type="text" inputMode="url" placeholder="ktl.example.com"
              autoComplete="url" autoCapitalize="off" spellCheck="false"
              value={address} onChange={(e) => setAddress(e.target.value)}
            />
            <span className="field-help">Whoever set up your server can tell you this. It’s the address you open KTL at in a browser. Got an invite? Paste it here.</span>
          </div>
          {error && <p className="hint"><Icon name="alert" size={16} /><span>{error}</span></p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !(normaliseServerUrl(address) || parseInvite(address))}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </form>
      </section>
    </main>
  );
}
