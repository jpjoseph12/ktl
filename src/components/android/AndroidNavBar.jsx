import { NavLink } from 'react-router-dom';
import { useKettle } from '../../context/KettleContext';
import { TABS } from '../../lib/kettle';
import Icon from '../Icon';

/* Material bottom navigation bar + gesture handle. `active` is a TABS id
   ('home' | 'bills' | 'balance' | 'yours' | 'house'), matching the
   original K.chrome('android', active) calls. Alerts no longer has a tab —
   it moved behind the badged bell in the app bar — so `active="alerts"`
   (still passed by the Alerts screen) simply matches nothing here. */
export default function AndroidNavBar({ active }) {
  const { openCount: getOpenCount } = useKettle();
  const openCount = getOpenCount();

  return (
    <>
      <nav className="md-navbar" aria-label="Main">
        {TABS.map((t) => {
          const n = t.badge ? openCount : 0;
          const current = t.id === active;
          return (
            <NavLink
              key={t.id}
              to={`/android/${t.file}`}
              className="md-dest"
              aria-current={current ? 'page' : undefined}
            >
              <span className="dest-icon">
                <Icon name={t.icon} size={22} />
                {n > 0 && <span className="dest-badge">{n}</span>}
              </span>
              {t.label}
            </NavLink>
          );
        })}
      </nav>
      {/* Room for the system gesture bar, so the tabs clear it. Zero-height
          wherever there's no bottom inset (the web preview included). */}
      <div className="md-gesture-safe" />
    </>
  );
}
