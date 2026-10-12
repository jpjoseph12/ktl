import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidAlerts from './Alerts';
import { useKettle } from '../../context/KettleContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

/* The bug: "Snooze" showed a toast ("Snoozed until later today") but
   called nothing else — the item it was attached to was still there on
   the very next render, indistinguishable from the button doing nothing.
   This pins the real fix: it must call K.snoozeItem with the item's type
   and id, which is what actually makes it disappear (via needsYou()
   filtering it out on the next KettleContext computation). */
const BILL = {
  id: 'bill-1', name: 'Council Tax', glyph: 'calendar',
  status: 'payment-due', payer: 'partner', payerId: 'partner-1',
  total: 100, yourShare: 50, theirShare: 50,
  needsDetails: false, detailsYou: { done: true }, detailsPartner: { done: true }
};

function baseKettle(overrides = {}) {
  return {
    you: { id: 'me', name: 'Alex', initials: 'A' },
    partner: { id: 'partner-1', name: 'Riley Morgan', initials: 'RM' },
    data: {
      household: { payoutRef: null },
      reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00', nudgeAfter: 24 },
      activity: [],
      people: { me: { name: 'Alex', initials: 'A' }, 'partner-1': { name: 'Riley Morgan', initials: 'RM' } },
      scheduled: []
    },
    all: () => [BILL],
    tracking: () => false,
    needsYou: () => [{ type: 'pay', item: BILL }],
    setStatus: vi.fn().mockResolvedValue(undefined),
    setFlag: vi.fn().mockResolvedValue(undefined),
    snoozeItem: vi.fn(),
    openCount: () => 1,
    ...overrides
  };
}

function renderAlerts(overrides) {
  useKettle.mockReturnValue(baseKettle(overrides));
  render(
    <MemoryRouter>
      <AndroidAlerts />
    </MemoryRouter>
  );
}

describe('AndroidAlerts — Snooze must actually dismiss the item, not just say it did', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('calls snoozeItem with the item’s type and id when tapped', async () => {
    const user = userEvent.setup();
    const snoozeItem = vi.fn();
    renderAlerts({ snoozeItem });

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    expect(snoozeItem).toHaveBeenCalledWith('pay', 'bill-1');
  });

  it('still tells the user it was snoozed', async () => {
    const user = userEvent.setup();
    renderAlerts();

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    expect(await screen.findByText(/snoozed until later today/i)).toBeInTheDocument();
  });

  it('an item that needsYou() no longer returns (i.e. actually snoozed) does not render at all', () => {
    renderAlerts({ needsYou: () => [] });

    expect(screen.queryByText(/council tax/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing needs you right now/i)).toBeInTheDocument();
  });
});
