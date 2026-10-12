import { Link } from 'react-router-dom';
import { ScreenProvider } from '../../context/ScreenContext';
import { useKettle } from '../../context/KettleContext';
import { TABLET_TABS } from '../../lib/kettle';
import Icon from '../Icon';
import Scrim from '../Scrim';
import Toast from '../Toast';
import { SERVER_URL } from '../../lib/api';

const SERVER_HOST = SERVER_URL ? new URL(SERVER_URL).host : '';

/* The tablet counterpart of PhoneShell: sidebar nav in place of the bottom
   tab bar, then the screen's own topbar + columns. Sheets, dialogs and the
   toast render inside .tablet-frame so tablet.css can float them centred. */
export default function TabletShell({ platform = 'android', active, children }) {
  return (
    <div className={'tablet-shell ' + platform}>
      <div className="tablet-frame">
        <ScreenProvider>
          <TabletSidebar active={active} />
          <div className="tablet-main">{children}</div>
          <Scrim />
          <Toast />
        </ScreenProvider>
      </div>
    </div>
  );
}

function TabletSidebar({ active }) {
  const K = useKettle();
  const { you, data: { household } } = K;
  const others = K.others || (K.partner ? [K.partner] : []);
  const openCount = K.openCount();

  return (
    <aside className="tablet-sidebar">
      <div className="tablet-sidebar-house">
        <span className="avatar-pair">
          <span className="avatar you" aria-hidden="true">{you?.initials}</span>
          {others[0] && <span className="avatar" aria-hidden="true">{others[0].initials}</span>}
        </span>
        <div className="grow">
          <div className="tablet-house-name">{household.name || 'Your household'}</div>
          <div className="meta">{SERVER_HOST}</div>
        </div>
      </div>
      <nav className="tablet-nav" aria-label="Main">
        {TABLET_TABS.map((t) => {
          const n = t.badge ? openCount : 0;
          return (
            <Link
              key={t.id}
              to={`/android/${t.file}`}
              className="tablet-nav-item"
              aria-current={t.id === active ? 'page' : undefined}
            >
              <span className="tablet-nav-icon">
                <Icon name={t.icon} size={20} />
                {n > 0 && <span className="tablet-nav-badge">{n}</span>}
              </span>
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/* The portrait, sidebar-less shell for linear flows like sign-in: one
   centred column, as in the prototype's tablet splash. */
export function TabletCenteredShell({ platform = 'android', children }) {
  return (
    <div className={'tablet-shell portrait ' + platform}>
      <div className="tablet-frame">
        <ScreenProvider>
          <div className="tablet-centered">
            <div className="tablet-centered-col">{children}</div>
          </div>
          <Scrim />
          <Toast />
        </ScreenProvider>
      </div>
    </div>
  );
}

export function TabletTopbar({ title, sub, children }) {
  return (
    <header className="tablet-topbar">
      <div>
        <h1>{title}</h1>
        {sub && <p className="meta">{sub}</p>}
      </div>
      {children && <div className="tablet-topbar-actions">{children}</div>}
    </header>
  );
}
