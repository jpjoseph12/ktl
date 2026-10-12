import { useCallback, useEffect, useState } from 'react';
import PhoneShell from '../../components/PhoneShell';
import { TabletCenteredShell } from '../../components/tablet/TabletShell';
import useIsTablet, { CENTERED_QUERY } from '../../lib/useIsTablet';
import { apiFetch } from '../../lib/api';

/* The setup and admin pages: one readable column, a phone screen on a
   phone and a centred column on anything wider. */
export default function PortalFrame({ title, sub, children }) {
  const wide = useIsTablet(CENTERED_QUERY);
  const body = (
    <main className="scroll">
      {title && (
        <header className="stack-sm" style={{ paddingTop: 'var(--space-4)' }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          {sub && <p className="meta">{sub}</p>}
        </header>
      )}
      {children}
    </main>
  );
  return wide
    ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell>
    : <PhoneShell platform="android">{body}</PhoneShell>;
}

/* Everything the admin page shows, from GET /api/admin, plus a way to
   save settings that hands back the refreshed picture. */
export function useAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setData(await apiFetch('/api/admin'));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (changes) => {
    const next = await apiFetch('/api/admin/settings', { method: 'PUT', body: changes });
    setData(next);
    return next;
  }, []);

  return { data, error, reload, save, setData };
}
