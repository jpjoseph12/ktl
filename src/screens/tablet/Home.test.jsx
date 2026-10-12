import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidHome from '../android/Home';
import { useKettle } from '../../context/KettleContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

const sam = { id: 'sam', name: 'Sam', initials: 'S' };

const councilTax = {
  id: 'ct', _table: 'bills', name: 'Council Tax', glyph: 'home', total: 180, yourShare: 90, theirShare: 90,
  payer: 'partner', payerId: 'sam', status: 'payment-due', due: '1 Oct', dueSort: '2026-10-01', frequency: 'Monthly'
};
const broadband = {
  id: 'bb', _table: 'bills', name: 'Broadband', glyph: 'wifi', total: 38, yourShare: 19, theirShare: 19,
  payer: 'you', payerId: 'me', status: 'scheduled', due: '12 Oct', dueSort: '2026-10-12', frequency: 'Monthly',
  provider: 'Virgin Media', note: 'Price rises in April'
};

function kettle(overrides = {}) {
  return {
    you: { id: 'me', name: 'Alex', initials: 'A' },
    partner: sam,
    others: [sam],
    data: {
      household: { id: 'h1', name: 'Flat 4', code: 'ABC-1234', payoutRef: 'KTL-FLAT4' },
      people: { me: { name: 'Alex', initials: 'A' }, sam: { name: 'Sam', initials: 'S' } },
      bills: [councilTax, broadband],
      lending: [],
      activity: []
    },
    balance: () => ({ youOwe: 90, theyOwe: 19, net: 71, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 }),
    balances: () => ({ sam: { youOwe: 90, theyOwe: 19, net: 71, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 } }),
    cycleTotals: () => ({ total: 218, paidOut: 0, closed: 0, count: 2 }),
    tracking: () => false,
    needsYou: () => [{ type: 'pay', item: councilTax }],
    openCount: () => 1,
    statusOf: (item) => item.status,
    closedStatus: () => 'sent',
    setStatus: vi.fn().mockResolvedValue(),
    ...overrides
  };
}

function renderHome() {
  return render(
    <MemoryRouter>
      <AndroidHome />
    </MemoryRouter>
  );
}

describe('Home at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}
    });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('swaps the bottom tab bar for the sidebar, with Alerts back as a badged destination', () => {
    useKettle.mockReturnValue(kettle());
    const { container } = renderHome();

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /alerts/i })).toHaveTextContent('1');
    expect(screen.getByText('Flat 4')).toBeInTheDocument();
    expect(container.querySelector('.md-navbar')).toBeNull();
  });

  it('opens on the first thing that needs you, and marks it sent straight from the detail pane', async () => {
    const K = kettle();
    useKettle.mockReturnValue(K);
    renderHome();

    expect(screen.getByText('your share of £180.00 — send it to Sam')).toBeInTheDocument();
    expect(screen.getByText('KTL-FLAT4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mark £90\.00 as sent/i }));
    expect(K.setStatus).toHaveBeenCalledWith('ct', 'sent', 'Marked £90.00 for Council Tax');
  });

  it('shows the balance, then a bill, in the detail pane as their rows are picked', () => {
    useKettle.mockReturnValue(kettle());
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: /you owe sam/i }));
    expect(screen.getByRole('link', { name: 'Settle up' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /paid the whole lot/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /broadband/i }));
    expect(screen.getByText('Virgin Media · Monthly')).toBeInTheDocument();
    expect(screen.getByText('Price rises in April')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /broadband/i })).toHaveAttribute('aria-current', 'true');
  });

  it('falls back to the balance once nothing needs you', () => {
    useKettle.mockReturnValue(kettle({ needsYou: () => [] }));
    renderHome();

    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settle up' })).toBeInTheDocument();
  });
});

describe('Home at tablet width — details take this cycle’s amount', () => {
  const realMatchMedia = window.matchMedia;
  const boxBill = {
    id: 'ss', _table: 'bills', name: 'Groceries box', glyph: 'calendar', total: 96.45,
    yourShare: 48.23, theirShare: 48.22, payer: 'you', payerId: 'me', status: 'awaiting-details',
    due: '7 Oct', dueSort: '2026-10-07', frequency: 'Monthly', needsDetails: true, detailsLabel: null,
    details: {}, detailsYou: { done: false, value: '' }, detailsPartner: { done: false, value: '' }
  };

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {}
    });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('re-splits the bill when a new amount is entered', async () => {
    const K = kettle({
      data: { ...kettle().data, bills: [boxBill] },
      needsYou: () => [{ type: 'details', item: boxBill }],
      recordBillAmount: vi.fn().mockResolvedValue(),
      setFlag: vi.fn().mockResolvedValue()
    });
    useKettle.mockReturnValue(K);
    renderHome();

    fireEvent.change(screen.getByLabelText(/what it came to this time/i), { target: { value: '71.25' } });
    fireEvent.click(screen.getByLabelText(/i confirm i’ve shared this/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm details shared/i }));

    await waitFor(() => expect(K.setFlag).toHaveBeenCalledWith('ss', 'detailsYou', true, undefined));
    expect(K.recordBillAmount).toHaveBeenCalledWith('ss', 71.25);
  });
});
