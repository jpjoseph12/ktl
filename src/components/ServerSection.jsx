import Icon from './Icon';
import CopyButton from './CopyButton';
import { useAuth } from '../context/AuthContext';
import { clearServer, IS_NATIVE, SERVER_URL } from '../lib/api';

/* House → Server. Which KTL server this is, so it can be typed into the
   app on another phone, and — for the owner — the way into the admin page
   where people and settings are managed. */
export default function ServerSection({ isOwner = false }) {
  const { signOut } = useAuth();

  async function logOut() {
    await signOut().catch(() => {});
  }

  async function changeServer() {
    await signOut().catch(() => {});
    clearServer();
    window.location.reload();
  }

  return (
    <section className="stack">
      <div className="section-head"><h2>Server</h2></div>
      <div className="card stack">
        <dl style={{ margin: 0 }}>
          <div className="kv"><dt>Address</dt><dd className="num" style={{ wordBreak: 'break-all' }}>{SERVER_URL}</dd></div>
        </dl>
        <p className="body-sm">
          Your household’s KTL lives here. To use it on another phone, install KTL and enter this address.
        </p>
        <CopyButton className="btn btn-secondary btn-sm" text={SERVER_URL} toastMsg="Address copied">
          <Icon name="copy" size={16} />Copy the address
        </CopyButton>
        {isOwner && (
          <a className="btn btn-secondary btn-sm" href={`${SERVER_URL}/admin`} target={IS_NATIVE ? '_blank' : undefined} rel="noreferrer">
            <Icon name="settings" size={16} />People and server settings
          </a>
        )}
      </div>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-sm" onClick={logOut}>Log out</button>
        {IS_NATIVE && <button className="btn btn-ghost btn-sm" onClick={changeServer}>Use a different server</button>}
      </div>
    </section>
  );
}
