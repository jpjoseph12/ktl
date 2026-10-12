import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import PortalFrame, { useAdmin } from './portal/PortalFrame';
import PeopleCard from './portal/PeopleCard';
import { AddressCard, AppCard, BackupsCard, EmailCard, PushCard, SignupCard, TunnelCard } from './portal/SettingsCards';

/* People and server settings, for whoever set the server up (the
   household's owner). Everyone else is told so and sent back. */
export default function Admin() {
  const admin = useAdmin();
  const { data, error } = admin;

  if (error) {
    return (
      <PortalFrame title="People and server settings">
        <p className="hint">
          <Icon name="lock" size={16} />
          <span>{error.code === 'owner_only' ? 'Only the person who set this server up can change these.' : error.message}</span>
        </p>
        <Link className="btn btn-secondary btn-block" to="/android/household">Back to KTL</Link>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame title="People and server settings" sub={data ? `${data.household?.name || 'Your household'} · KTL ${data.version}` : 'Loading…'}>
      {data && (
        <>
          <PeopleCard admin={admin} />
          <AddressCard admin={admin} />
          <AppCard siteUrl={data.siteUrl} />
          <SignupCard admin={admin} />
          <EmailCard admin={admin} />
          <PushCard admin={admin} />
          <TunnelCard admin={admin} />
          <BackupsCard admin={admin} />
        </>
      )}
      <Link className="btn btn-ghost btn-block" to="/android/household">Back to KTL</Link>
    </PortalFrame>
  );
}
