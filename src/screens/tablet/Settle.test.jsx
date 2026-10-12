import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidSettle from '../android/Settle';
import { useKettle } from '../../context/KettleContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

const YOU = { id: 'me', name: 'Alex', initials: 'A' };
const SAM = { id: 'sam', name: 'Sam', initials: 'S' };
const RILEY = { id: 'riley', name: 'Riley', initials: 'R' };

function item(overrides) {
  return {
    _table: 'bills', glyph: 'home', payer: 'partner', payerId: SAM.id, total: 100, yourShare: 50, theirShare: 50,
    shares: { me: 50, sam: 50 }, outstanding: {}, paid: {}, status: 'payment-due', ...overrides
  };
}

const rent = item({ id: 'rent', name: 'Rent', total: 1400, yourShare: 700, theirShare: 700, shares: { me: 700, sam: 700 }, due: '1 Oct' });
const water = item({ id: 'water', name: 'Thames Water', payer: 'you', payerId: YOU.id, total: 42, yourShare: 21, theirShare: 21, shares: { me: 21, sam: 21 }, due: '20 Oct' });
const wifi = item({ id: 'wifi', name: 'Virgin Media', payer: 'you', payerId: YOU.id, total: 38, yourShare: 19, theirShare: 19, status: 'sent', due: '12 Oct' });

function kettle(overrides = {}) {
  return {
    you: YOU,
    partner: SAM,
    others: [SAM],
    data: {
      household: { name: 'Flat 4', code: 'ABC-1234', payoutRef: 'FLAT4' },
      people: { me: YOU, sam: SAM, riley: RILEY },
      reminders: { nudgeAfter: 24 }
    },
    all: () => [rent, water, wifi],
    balances: () => ({ sam: { youOwe: 700, theyOwe: 21, net: 679 } }),
    balance: () => ({ youOwe: 700, theyOwe: 21, net: 679, inFlightToYou: 19, inFlightFromYou: 0 }),
    tracking: () => false,
    openCount: () => 1,
    statusOf: (i) => i.status,
    settleWith: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderSettle(K = kettle()) {
  useKettle.mockReturnValue(K);
  const utils = render(
    <MemoryRouter>
      <AndroidSettle />
    </MemoryRouter>
  );
  return { ...utils, K, pane: within(utils.container.querySelector('.tablet-detail-pane')) };
}

describe('Balance at phone width (unchanged by the tablet layout)', () => {
  beforeEach(() => useKettle.mockReset());

  it('keeps the hero card, static lines, bottom nav and the netting hint', () => {
    useKettle.mockReturnValue(kettle());
    const { container } = render(<MemoryRouter><AndroidSettle /></MemoryRouter>);

    expect(container.querySelector('.tablet-shell')).toBeNull();
    expect(container.querySelector('.md-navbar')).not.toBeNull();
    expect(screen.getByRole('button', { name: /settle up £679\.00/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^rent/i })).not.toBeInTheDocument();
    expect(within(container.querySelector('.scroll')).getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText(/one transfer per person settles them up/i)).toBeInTheDocument();
  });
});

describe('Balance at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('opens on the summary with the balance bar, and settles from the topbar', async () => {
    const user = userEvent.setup();
    const { container, pane } = renderSettle();

    expect(screen.getByRole('link', { name: /balance/i })).toHaveAttribute('aria-current', 'page');
    expect(pane.getByText('Between you and Sam')).toBeInTheDocument();
    expect(container.querySelector('.tablet-detail-pane .balance-bar')).not.toBeNull();

    const topbar = within(container.querySelector('.tablet-topbar'));
    await user.click(topbar.getByRole('button', { name: /settle up £679\.00/i }));
    expect(container.querySelector('.sheet.open')).toHaveTextContent('Settle up with Sam');
  });

  it('shows a picked line in the pane, then goes back to the summary', async () => {
    const user = userEvent.setup();
    const { pane } = renderSettle();

    await user.click(screen.getByRole('button', { name: /^rent/i }));
    expect(pane.getByText('You owe Sam')).toBeInTheDocument();
    expect(pane.getByText('£1,400.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^rent/i })).toHaveAttribute('aria-current', 'true');

    await user.click(pane.getByRole('button', { name: /back to summary/i }));
    expect(pane.getByText('Between you and Sam')).toBeInTheDocument();
  });

  it('drops back to the summary when the picked line’s tab is switched away', async () => {
    const user = userEvent.setup();
    const { pane } = renderSettle();

    await user.click(screen.getByRole('button', { name: /^rent/i }));
    await user.click(screen.getByRole('tab', { name: 'In flight' }));
    expect(pane.getByText('Between you and Sam')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /virgin media/i }));
    expect(pane.getByText('It’s been sent — confirm when it lands.')).toBeInTheDocument();
  });

  it('lists each person to settle with when there are several, with no single topbar button', () => {
    const { container, pane } = renderSettle(kettle({
      others: [SAM, RILEY],
      balances: () => ({ sam: { youOwe: 700, theyOwe: 0, net: 700 }, riley: { youOwe: 0, theyOwe: 30, net: -30 } })
    }));

    expect(pane.getByText('Your household balance')).toBeInTheDocument();
    expect(pane.getByText('Riley')).toBeInTheDocument();
    expect(within(container.querySelector('.tablet-topbar')).queryByRole('button')).not.toBeInTheDocument();
  });
});
