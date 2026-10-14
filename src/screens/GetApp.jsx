import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import PhoneShell from '../components/PhoneShell';
import { TabletCenteredShell } from '../components/tablet/TabletShell';
import useIsTablet, { CENTERED_QUERY } from '../lib/useIsTablet';
import { IS_NATIVE, SERVER_URL } from '../lib/api';
import { appConnectLink } from '../lib/invite';

const RELEASES = 'https://github.com/jpjoseph12/ktl/releases/latest';

/* /get — where the QR code on the admin page leads. On a phone: open this
   server in the KTL app (which fills its address in), get the app, or just
   use KTL in the browser. */
export default function GetApp() {
  const wide = useIsTablet(CENTERED_QUERY);
  const host = SERVER_URL ? new URL(SERVER_URL).host : '';
  const android = !IS_NATIVE && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  const body = (
    <main className="splash-main">
      <section className="splash-panel">
        <div className="splash-brand">
          <img src="/assets/brand/logo-kettle.png" alt="" className="splash-icon" />
          <h1 className="splash-wordmark">KTL</h1>
          <p className="splash-tagline">Your household’s KTL is at <strong>{host}</strong>.</p>
        </div>
        <div className="splash-form stack">
          {android && (
            <a className="btn btn-primary btn-block" href={appConnectLink(SERVER_URL)}><Icon name="phone" size={16} />Open in the KTL app</a>
          )}
          <a className={'btn btn-block ' + (android ? 'btn-secondary' : 'btn-primary')} href={RELEASES}>Get the Android app</a>
          <Link className="btn btn-ghost btn-block" to="/android/onboarding">Use KTL in this browser</Link>
          <p className="meta splash-shortcut">
            {android
              ? 'Already have the app? “Open in the KTL app” connects it to this server.'
              : <>In the Android app, enter <strong>{SERVER_URL}</strong> when it asks which server to use.</>}
          </p>
        </div>
      </section>
    </main>
  );
  return wide ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell> : <PhoneShell platform="android">{body}</PhoneShell>;
}
