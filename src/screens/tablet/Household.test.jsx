import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidHousehold from '../android/Household';
import { useKettle } from '../../context/KettleContext';
import { useWalkthrough } from '../../context/WalkthroughContext';

vi.mock('../../context/AppLockContext', () => ({ useAppLock: () => ({ on: false, lock: null, turnOn: async () => {}, changePin: async () => {}, turnOff: () => {}, setOption: () => {} }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ updatePassword: async () => {}, signOut: async () => {} }) }));
vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

vi.mock('../../context/WalkthroughContext', () => ({
  useWalkthrough: vi.fn()
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn().mockResolvedValue(undefined) }
}));

useWalkthrough.mockReturnValue({ targetRef: () => () => {}, restart: vi.fn() });

const YOU = { id: 'me', name: 'Alex', initials: 'A', role: 'owner' };
const SAM = { id: 'sam', name: 'Sam', initials: 'S' };

function kettle(overrides = {}) {
  return {
    you: YOU,
    partner: SAM,
    members: [YOU, SAM],
    data: {
      household: { id: 'h1', name: 'Our place', code: 'ABC-1234', payoutRef: 'FLAT4', mode: 'chase', since: 'Jan 2026', split: '50% each' },
      reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00', nudgeAfter: 24, quietFrom: '22:00', quietTo: '08:00' }
    },
    balance: () => ({ youOwe: 0, theyOwe: 0, net: 0, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 }),
    openCount: () => 0,
    mode: () => 'chase',
    setMode: vi.fn().mockResolvedValue('chase'),
    renameHousehold: vi.fn().mockResolvedValue(undefined),
    memberExitSummary: () => ({ openCount: 0, theyOweYou: 0, youOweThem: 0 }),
    removeMember: vi.fn().mockResolvedValue(undefined),
    leaveHousehold: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderHousehold(K = kettle()) {
  useKettle.mockReturnValue(K);
  const utils = render(
    <MemoryRouter>
      <AndroidHousehold />
    </MemoryRouter>
  );
  return { ...utils, K, pane: () => within(utils.container.querySelector('.tablet-detail-pane')) };
}

describe('Household at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('opens on who’s in, with the name and people in the topbar', () => {
    const { container, pane } = renderHousehold();

    expect(screen.getByRole('link', { name: /house/i })).toHaveAttribute('aria-current', 'page');
    const topbar = within(container.querySelector('.tablet-topbar'));
    expect(topbar.getByRole('heading', { name: 'Our place' })).toBeInTheDocument();
    expect(topbar.getByText('2 people · on KTL since Jan 2026')).toBeInTheDocument();
    expect(pane().getByText('Sam')).toBeInTheDocument();
    expect(pane().queryByText('Reminders')).not.toBeInTheDocument();
  });

  it('shows one settings group at a time as categories are picked', async () => {
    const user = userEvent.setup();
    const { pane } = renderHousehold();
    const nav = within(screen.getByRole('navigation', { name: 'Household settings' }));

    expect(nav.getByRole('button', { name: 'Who’s in' })).toHaveAttribute('aria-current', 'true');

    await user.click(nav.getByRole('button', { name: 'Server' }));
    expect(pane().getByRole('button', { name: /copy the address/i })).toBeInTheDocument();
    expect(pane().queryByText('Sam')).not.toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: 'Reminders' }));
    expect(pane().getByText('Ask for details')).toBeInTheDocument();
  });

  it('still switches the mode and renames from the tablet layout', async () => {
    const user = userEvent.setup();
    const { container, K, pane } = renderHousehold();

    await user.click(screen.getByRole('button', { name: 'How you use KTL' }));
    await user.click(pane().getByRole('tab', { name: 'Tracking only' }));
    expect(K.setMode).toHaveBeenCalledWith('track');

    await user.click(within(container.querySelector('.tablet-topbar')).getByRole('button', { name: /rename/i }));
    expect(container.querySelector('.sheet.open')).toHaveTextContent('Rename your household');
  });

  it('lists account deletion as its own category', async () => {
    const user = userEvent.setup();
    const { pane } = renderHousehold();

    await user.click(screen.getByRole('button', { name: 'Delete your account' }));
    expect(pane().getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

});
