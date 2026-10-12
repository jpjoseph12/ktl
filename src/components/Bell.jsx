import { Link } from 'react-router-dom';
import { useKettle } from '../context/KettleContext';
import Icon from './Icon';

/* The alerts bell used in app bars — replaces the plain bell icon once
   Alerts stopped being a bottom-nav tab. Carries the same open-item badge
   the tab used to. */
export default function Bell({ to = '/android/alerts', size = 22 }) {
  const { openCount } = useKettle();
  const n = openCount();
  return (
    <Link className="md-iconbtn" to={to} aria-label={`Alerts, ${n} need you`}>
      <Icon name="bell" size={size} />
      {n > 0 && <span className="nav-badge">{n}</span>}
    </Link>
  );
}
