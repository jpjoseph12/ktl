import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessSection, HouseholdSection, OverviewSection } from './AdminSections';
import { BackupsCard } from './SettingsCards';
import { ScreenProvider } from '../../context/ScreenContext';

const apiFetch = vi.fn();
vi.mock('../../lib/api', () => ({
  apiFetch: (...args) => apiFetch(...args),
  SERVER_URL: 'https://ktl.example.com',
  api: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }
}));
vi.mock('../../lib/saveFile', () => ({ saveFile: vi.fn() }));

const set = (value, source = 'settings') => ({ value, set: Boolean(value), source });

function overview(over = {}) {
  return {
    version: '1.1.0',
    siteUrl: 'https://ktl.example.com',
    household: { id: 'h1', name: 'Flat 4', mode: 'chase', reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00' } },
    people: [
      { id: 'o1', name: 'Alex', email: 'alex@example.com', role: 'owner', hasPassword: true, inHousehold: true },
      { id: 'p2', name: 'Sam', email: 'sam@example.com', role: 'member', hasPassword: false, inHousehold: true }
    ],
    maxPeople: 6,
    settings: {
      siteUrl: set('https://ktl.example.com'), signup: set('false'), smtpHost: set(''), smtpPort: set(''), smtpUser: set(''),
      smtpPass: set(''), smtpSender: set(''), smtpSenderName: set(''), tunnelToken: set(''),
      trustProxy: set(''), backupHour: set(''), backupKeep: set(''), timezone: set('')
    },
    schedule: { hour: 3, keep: 14, timezone: 'Europe/London' },
    push: { configured: false, projectId: null, fromContainer: false },
    health: { healthy: true, database: true, auth: true, api: true },
    backups: [{ name: 'ktl-2026-10-13.dump', size: 200000, mtime: new Date().toISOString() }],
    ...over
  };
}

const admin = (data = overview()) => ({ data, setData: vi.fn(), save: vi.fn().mockResolvedValue(data), reload: vi.fn() });
const wrap = (ui) => render(<MemoryRouter><ScreenProvider>{ui}</ScreenProvider></MemoryRouter>);

describe('Admin — Overview', () => {
  it('shows the server is healthy, and what’s left to set up', () => {
    wrap(<OverviewSection data={overview()} />);
    expect(screen.getByText('All working')).toBeInTheDocument();
    expect(screen.getByText('Sam still to choose a password')).toBeInTheDocument();
    expect(screen.getByText('Reached over https')).toBeInTheDocument();
    expect(screen.getByText('Backed up in the last two days')).toBeInTheDocument();
  });

  it('warns about a part of the server that isn’t answering, and an http address on the internet', () => {
    wrap(<OverviewSection data={overview({ siteUrl: 'http://ktl.example.com', health: { healthy: false, database: true, auth: false, api: true } })} />);
    expect(screen.getByText('Needs a look')).toBeInTheDocument();
    expect(screen.getByText(/passwords would cross the internet unencrypted/)).toBeInTheDocument();
  });

  it('doesn’t nag about http on a home network address', () => {
    wrap(<OverviewSection data={overview({ siteUrl: 'http://192.168.1.20:8095' })} />);
    expect(screen.queryByText(/cross the internet unencrypted/)).not.toBeInTheDocument();
  });
});

describe('Admin — Household', () => {
  beforeEach(() => apiFetch.mockReset());

  it('saves the name, how you use KTL and the reminder times together', async () => {
    const user = userEvent.setup();
    const a = admin();
    apiFetch.mockResolvedValueOnce(overview());
    wrap(<HouseholdSection admin={a} />);

    await user.clear(screen.getByLabelText('Household name'));
    await user.type(screen.getByLabelText('Household name'), 'The Burrow');
    await user.click(screen.getByRole('tab', { name: 'Tracking only' }));
    expect(screen.getByText(/already marked as sent is settled/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Send the money (days before)'));
    await user.type(screen.getByLabelText('Send the money (days before)'), '3');
    await user.click(screen.getByRole('switch', { name: 'Nudge if nobody confirms' }));
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    await user.click(screen.getByRole('button', { name: 'Save household' }));

    expect(apiFetch).toHaveBeenCalledWith('/api/admin/household', {
      method: 'PUT',
      body: {
        name: 'The Burrow', mode: 'track',
        reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 3, paymentTime: '18:00', nudgeAfter: 0, quietFrom: '00:00', quietTo: '00:00', weeklyDigest: true }
      }
    });
    expect(a.setData).toHaveBeenCalled();
  });
});

describe('Admin — Sign-in & address', () => {
  beforeEach(() => apiFetch.mockReset());

  it('tests an address from the server and says whether it reaches this KTL', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ ok: true, message: 'https://ktl.example.com reaches this KTL server.' });
    wrap(<AccessSection admin={admin()} />);
    await user.click(screen.getByRole('button', { name: 'Test this address' }));
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/test-address', { method: 'POST', body: { url: 'https://ktl.example.com' } });
    expect(await screen.findByText('https://ktl.example.com reaches this KTL server.')).toBeInTheDocument();
  });

  it('turns trusting a reverse proxy on', async () => {
    const user = userEvent.setup();
    const a = admin();
    wrap(<AccessSection admin={a} />);
    await user.click(screen.getByRole('switch', { name: 'Trust a reverse proxy' }));
    expect(a.save).toHaveBeenCalledWith({ trustProxy: true });
  });

  it('shows a setting the container fixes, without a way to change it here', () => {
    const data = overview();
    data.settings.trustProxy = set('true', 'container');
    wrap(<AccessSection admin={admin(data)} />);
    expect(screen.getByRole('switch', { name: 'Trust a reverse proxy' })).toBeDisabled();
  });
});

describe('Admin — Backups', () => {
  beforeEach(() => apiFetch.mockReset());

  it('saves when backups run, how many are kept and the time zone', async () => {
    const user = userEvent.setup();
    const a = admin();
    wrap(<BackupsCard admin={a} />);
    await user.selectOptions(screen.getByLabelText('Each night at'), '5');
    await user.clear(screen.getByLabelText('Keep the last'));
    await user.type(screen.getByLabelText('Keep the last'), '30');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(a.save).toHaveBeenCalledWith({ backupHour: 5, backupKeep: 30, timezone: 'Europe/London' });
  });

  it('only restores once REPLACE is typed', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ restored: 'ktl-2026-10-13.dump', safetyCopy: 'ktl-2026-10-14-before-restore.dump' });
    wrap(<BackupsCard admin={admin()} />);

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    const form = screen.getByLabelText('Type REPLACE to confirm').closest('form');
    const go = within(form).getByRole('button', { name: 'Restore this backup' });
    expect(go).toBeDisabled();
    await user.type(screen.getByLabelText('Type REPLACE to confirm'), 'REPLACE');
    await user.click(go);

    expect(apiFetch).toHaveBeenCalledWith('/api/admin/restore', { method: 'POST', body: { name: 'ktl-2026-10-13.dump', confirm: 'REPLACE' } });
    expect(await screen.findByText(/Your data from before is saved as ktl-2026-10-14-before-restore.dump/)).toBeInTheDocument();
  });
});
