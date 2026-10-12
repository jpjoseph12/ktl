import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidHome from './Home';
import { useKettle } from '../../context/KettleContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

/* A brand-new household — no partner, no bills, no activity. This is the
   exact shape that crashed in production: Home.jsx destructured
   `household` straight off K instead of K.data.household, which is
   undefined for everyone since KettleContext never exposed it at the
   top level. `household.name` then threw with no error boundary to
   catch it, blanking the whole screen after a real, successful sign-in. */
function emptyKettle(overrides = {}) {
  return {
    you: { id: 'me', name: 'Alex', initials: 'A' },
    partner: null,
    data: {
      household: { id: 'h1', name: "Alex's household", code: 'ABC-1234', payoutRef: null },
      bills: [],
      lending: [],
      activity: [],
      reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00' }
    },
    balance: () => ({ youOwe: 0, theyOwe: 0, net: 0, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 }),
    cycleTotals: () => ({ total: 0, paidOut: 0, closed: 0, count: 0 }),
    tracking: () => false,
    needsYou: () => [],
    openCount: () => 0,
    statusOf: (item) => item.status,
    ...overrides
  };
}

describe('AndroidHome — renders for a brand-new, empty household', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('does not crash when there is no partner and no data yet', () => {
    useKettle.mockReturnValue(emptyKettle());
    render(
      <MemoryRouter>
        <AndroidHome />
      </MemoryRouter>
    );

    expect(screen.getByText("Alex's household")).toBeInTheDocument();
    expect(screen.getByText(/nothing added yet/i)).toBeInTheDocument();
  });
});

describe('AndroidHome — no pretend device chrome', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('draws no fake status bar (clock, signal, battery) or gesture line', () => {
    useKettle.mockReturnValue(emptyKettle());
    const { container } = render(
      <MemoryRouter>
        <AndroidHome />
      </MemoryRouter>
    );

    expect(screen.queryByText('9:41')).not.toBeInTheDocument();
    expect(container.querySelector('.md-status, .md-punchhole, .status-icons, .md-gesture')).toBeNull();
    // the real safe-area spacer under the tabs stays
    expect(container.querySelector('.md-navbar + .md-gesture-safe')).not.toBeNull();
  });
});

describe('AndroidHome — per-person balance list for 3+ member households', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('shows one row per other member instead of a single pooled net figure', () => {
    const sam = { id: 'sam', name: 'Sam', initials: 'S' };
    const riley = { id: 'riley', name: 'Riley', initials: 'R' };
    useKettle.mockReturnValue(emptyKettle({
      partner: sam,
      others: [sam, riley],
      balances: () => ({
        sam: { youOwe: 20, theyOwe: 0, net: 20, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 },
        riley: { youOwe: 0, theyOwe: 15, net: -15, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 }
      }),
      balance: () => ({ youOwe: 20, theyOwe: 15, net: 5, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 })
    }));
    render(
      <MemoryRouter>
        <AndroidHome />
      </MemoryRouter>
    );

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Riley')).toBeInTheDocument();
    expect(screen.getByText(/you owe £20\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/owes you £15\.00/i)).toBeInTheDocument();
    // no single "paid the whole lot" shortcut once there's more than one counterparty
    expect(screen.queryByRole('link', { name: /paid the whole lot/i })).not.toBeInTheDocument();
  });

  it('keeps the single-partner "paid the whole lot" shortcut for exactly one other member', () => {
    const sam = { id: 'sam', name: 'Sam', initials: 'S' };
    useKettle.mockReturnValue(emptyKettle({
      partner: sam,
      others: [sam],
      balances: () => ({ sam: { youOwe: 20, theyOwe: 0, net: 20, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 } }),
      balance: () => ({ youOwe: 20, theyOwe: 0, net: 20, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 })
    }));
    render(
      <MemoryRouter>
        <AndroidHome />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /paid the whole lot/i })).toBeInTheDocument();
  });
});

/* A variable bill's new monthly figure used to go into the free-text
   details box, which only stored it as text — the bill stayed at its old
   total and so did everyone's share. */
describe('AndroidHome — the details sheet takes this cycle’s amount', () => {
  const boxBill = {
    id: 'ss', _table: 'bills', name: 'Groceries box', glyph: 'calendar', total: 96.45,
    yourShare: 48.23, theirShare: 48.22, payer: 'you', payerId: 'me', status: 'awaiting-details',
    due: '7 Oct', dueSort: '2026-10-07', needsDetails: true, detailsLabel: null,
    details: {}, detailsYou: { done: false, value: '' }, detailsPartner: { done: false, value: '' }
  };
  const sam = { id: 'sam', name: 'Sam', initials: 'S' };

  function detailsKettle() {
    return emptyKettle({
      partner: sam,
      others: [sam],
      data: { ...emptyKettle().data, bills: [boxBill], people: { me: { name: 'Alex' }, sam: { name: 'Sam' } } },
      needsYou: () => [{ type: 'details', item: boxBill }],
      recordBillAmount: vi.fn().mockResolvedValue(),
      setFlag: vi.fn().mockResolvedValue()
    });
  }

  function openSheet() {
    render(
      <MemoryRouter>
        <AndroidHome />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add details' }));
    fireEvent.click(screen.getByLabelText(/i confirm i’ve shared this/i));
  }

  beforeEach(() => {
    useKettle.mockReset();
  });

  it('re-splits the bill when a new amount is entered', async () => {
    const K = detailsKettle();
    useKettle.mockReturnValue(K);
    openSheet();

    expect(screen.getByLabelText(/what it came to this time/i)).toHaveValue('96.45');
    fireEvent.change(screen.getByLabelText(/what it came to this time/i), { target: { value: '71.25' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm details shared/i }));

    await waitFor(() => expect(K.setFlag).toHaveBeenCalledWith('ss', 'detailsYou', true, undefined));
    expect(K.recordBillAmount).toHaveBeenCalledWith('ss', 71.25);
  });

  it('leaves the amount alone when it hasn’t changed', async () => {
    const K = detailsKettle();
    useKettle.mockReturnValue(K);
    openSheet();

    fireEvent.change(screen.getByLabelText(/anything else to share/i), { target: { value: 'Two boxes this month' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm details shared/i }));

    await waitFor(() => expect(K.setFlag).toHaveBeenCalledWith('ss', 'detailsYou', true, 'Two boxes this month'));
    expect(K.recordBillAmount).not.toHaveBeenCalled();
  });

  it('won’t save an amount that isn’t money', async () => {
    const K = detailsKettle();
    useKettle.mockReturnValue(K);
    openSheet();

    fireEvent.change(screen.getByLabelText(/what it came to this time/i), { target: { value: 'seventy' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm details shared/i }));

    expect(screen.getByLabelText(/what it came to this time/i).closest('.field')).toHaveClass('invalid');
    expect(K.recordBillAmount).not.toHaveBeenCalled();
    expect(K.setFlag).not.toHaveBeenCalled();
  });
});
