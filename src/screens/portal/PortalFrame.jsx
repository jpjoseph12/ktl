import { useCallback, useEffect, useState } from 'react';
import PhoneShell from '../../components/PhoneShell';
import Icon from '../../components/Icon';
import Scrim from '../../components/Scrim';
import Toast from '../../components/Toast';
import { TabletCenteredShell, TabletTopbar } from '../../components/tablet/TabletShell';
import { ScreenProvider } from '../../context/ScreenContext';
import useIsTablet, { CENTERED_QUERY, TABLET_QUERY } from '../../lib/useIsTablet';
import { apiFetch, SERVER_URL } from '../../lib/api';

const SERVER_HOST = SERVER_URL ? new URL(SERVER_URL).host : '';

/* The setup and admin pages.
 *
 * On a computer (≥1000px): a desktop layout — a left rail with the steps
 * or sections (`rail`), a topbar, and a readable main column. On a tablet
 * held upright: one centred column. On a phone: a phone screen.
 *
 * `rail` is what goes under the KTL mark (a <StepRail> or <SectionRail>),
 * `railFoot` sits at the bottom of the rail, `actions` in the topbar. */
export default function PortalFrame({ title, sub, rail, railFoot, actions, wide: wideContent = false, children }) {
  const desktop = useIsTablet(TABLET_QUERY);
  const centred = useIsTablet(CENTERED_QUERY);

  if (desktop) {
    return (
      <div className="tablet-shell android portal-shell">
        <div className="tablet-frame">
          <ScreenProvider>
            <aside className="tablet-sidebar">
              <div className="tablet-sidebar-house">
                <img src="/assets/brand/logo-kettle.png" alt="" className="portal-mark" />
                <div className="grow">
                  <div className="tablet-house-name">KTL</div>
                  <div className="meta">{SERVER_HOST}</div>
                </div>
              </div>
              {rail}
              {railFoot && <div className="tablet-sidebar-foot">{railFoot}</div>}
            </aside>
            <div className="tablet-main">
              {title && <TabletTopbar title={title} sub={sub}>{actions}</TabletTopbar>}
              <main className="portal-main">
                <div className={'portal-col' + (wideContent ? ' wide' : '')}>{children}</div>
              </main>
            </div>
            <Scrim />
            <Toast />
          </ScreenProvider>
        </div>
      </div>
    );
  }

  const body = (
    <main className="scroll">
      {title && (
        <header className="stack-sm" style={{ paddingTop: 'var(--space-4)' }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          {sub && <p className="meta">{sub}</p>}
        </header>
      )}
      {children}
      {railFoot && <div className="stack-sm">{railFoot}</div>}
    </main>
  );
  return centred
    ? <TabletCenteredShell platform="android">{body}</TabletCenteredShell>
    : <PhoneShell platform="android">{body}</PhoneShell>;
}

/* Numbered steps down the rail, ticked once they're behind you. */
export function StepRail({ steps, current }) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="tablet-nav portal-steps" aria-label="Setup steps">
      {steps.map((s, i) => (
        <li key={s.id} className="tablet-nav-item" aria-current={i === at ? 'step' : undefined} data-done={i < at || undefined}>
          <span className="portal-step-num" aria-hidden="true">
            {i < at ? <Icon name="check" size={14} /> : i + 1}
          </span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
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
