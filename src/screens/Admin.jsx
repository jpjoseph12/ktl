import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import PortalFrame, { useAdmin } from './portal/PortalFrame';
import PeopleCard from './portal/PeopleCard';
import { AccessSection, HouseholdSection, OverviewSection } from './portal/AdminSections';
import { BackupsCard, EmailCard, PushCard, TunnelCard } from './portal/SettingsCards';
import useIsTablet from '../lib/useIsTablet';

/* Everything about this server, for whoever runs it (the household's
   owner): one section at a time, down a rail on a computer and as a list
   on a phone. Everyone else is told so and sent back. */
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'household', label: 'Household', icon: 'landmark' },
  { id: 'people', label: 'People', icon: 'users' },
  { id: 'access', label: 'Sign-in & address', icon: 'lock' },
  { id: 'email', label: 'Email', icon: 'send' },
  { id: 'push', label: 'Push notifications', icon: 'bell' },
  { id: 'remote', label: 'Remote access', icon: 'signal' },
  { id: 'backups', label: 'Backups', icon: 'refresh' }
];

function SectionRail({ current }) {
  return (
    <nav className="tablet-nav" aria-label="Settings">
      {SECTIONS.map((s) => (
        <Link key={s.id} to={`/admin/${s.id}`} className="tablet-nav-item" aria-current={s.id === current ? 'page' : undefined}>
          <span className="tablet-nav-icon"><Icon name={s.icon} size={20} /></span>
          <span>{s.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Body({ id, admin }) {
  const { data } = admin;
  if (id === 'overview') return <OverviewSection data={data} />;
  if (id === 'household') return <HouseholdSection admin={admin} />;
  if (id === 'people') return <PeopleCard admin={admin} />;
  if (id === 'access') return <AccessSection admin={admin} />;
  if (id === 'email') return <EmailCard admin={admin} />;
  if (id === 'push') return <PushCard admin={admin} />;
  if (id === 'remote') return <TunnelCard admin={admin} />;
  return <BackupsCard admin={admin} />;
}

export default function Admin() {
  const { section } = useParams();
  const desktop = useIsTablet();
  const admin = useAdmin();
  const { data, error } = admin;
  const back = <Link className="btn btn-ghost btn-block" to="/android/household">Back to KTL</Link>;

  if (error) {
    return (
      <PortalFrame title="People and server settings">
        <p className="hint">
          <Icon name="lock" size={16} />
          <span>{error.code === 'owner_only' ? 'Only the person who runs this server can change these.' : error.message}</span>
        </p>
        {back}
      </PortalFrame>
    );
  }

  const current = SECTIONS.find((s) => s.id === section) || (desktop ? SECTIONS[0] : null);
  const sub = data ? `${data.household?.name || 'Your household'} · KTL ${data.version}` : 'Loading…';

  // A phone with no section chosen: the list of sections.
  if (!current) {
    return (
      <PortalFrame title="People and server settings" sub={sub}>
        <div className="list">
          {SECTIONS.map((s) => (
            <Link key={s.id} className="item" to={`/admin/${s.id}`}>
              <span className="glyph on-warm"><Icon name={s.icon} size={18} /></span>
              <span className="grow item-title">{s.label}</span>
              <Icon name="chevron" size={16} />
            </Link>
          ))}
        </div>
        {back}
      </PortalFrame>
    );
  }

  return (
    <PortalFrame title={current.label} sub={sub} rail={<SectionRail current={current.id} />} railFoot={desktop ? back : null}>
      {!desktop && <Link className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} to="/admin"><Icon name="back" size={16} />All settings</Link>}
      {data ? <Body key={current.id} id={current.id} admin={admin} /> : <p className="meta">Loading…</p>}
      {!desktop && back}
    </PortalFrame>
  );
}
