import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidBills from '../android/Bills';
import { useKettle } from '../../context/KettleContext';
import { useWalkthrough } from '../../context/WalkthroughContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

vi.mock('../../context/WalkthroughContext', () => ({
  useWalkthrough: vi.fn()
}));

useWalkthrough.mockReturnValue({ targetRef: () => () => {} });

const YOU = { id: 'me', name: 'Alex', initials: 'A' };
const SAM = { id: 'sam', name: 'Sam', initials: 'S' };

function bill(overrides) {
  return {
    _table: 'bills', glyph: 'home', payer: 'partner', payerId: SAM.id, total: 100, yourShare: 50, theirShare: 50,
    shares: { me: 50, sam: 50 }, paid: {}, details: {}, frequency: 'Monthly', status: 'scheduled', ...overrides
  };
}

const rent = bill({ id: 'rent', name: 'Rent', total: 1400, yourShare: 700, theirShare: 700, due: '1 Oct', dueSort: '2026-10-01', status: 'payment-due' });
const water = bill({ id: 'water', name: 'Thames Water', provider: 'Thames Water', payer: 'you', payerId: YOU.id, due: '20 Oct', dueSort: '2026-10-20', note: 'Meter fitted in May' });
const takeaway = bill({ id: 'takeaway', _table: 'lending', name: 'Takeaway', total: 30, yourShare: 0, theirShare: 30, payer: 'you', payerId: YOU.id, date: '14 Sep' });

function kettle(overrides = {}) {
  const all = [rent, water, takeaway];
  return {
    you: YOU,
    partner: SAM,
    members: [YOU, SAM],
    others: [SAM],
    data: {
      household: { name: 'Flat 4', code: 'ABC-1234', split: '50% each' },
      people: { me: YOU, sam: SAM },
      bills: [rent, water],
      lending: [takeaway],
      reminders: { paymentLead: 2, paymentTime: '18:00', detailsLead: 5, detailsTime: '09:00', nudgeAfter: 24 }
    },
    cycleTotals: () => ({ total: 1500, paidOut: 0, closed: 0, count: 2 }),
    find: (id) => all.find((i) => i.id === id) || null,
    labelOf: (i) => i.status,
    statusOf: (i) => i.status,
    openCount: () => 1,
    setStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderBills(K = kettle()) {
  useKettle.mockReturnValue(K);
  const utils = render(
    <MemoryRouter>
      <AndroidBills />
    </MemoryRouter>
  );
  return { ...utils, K };
}

const detailPane = (container) => within(container.querySelector('.tablet-detail-pane'));

describe('Bills at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('shows the first bill in the detail pane without opening a sheet, and lists every bill', () => {
    const { container } = renderBills();

    expect(screen.getByRole('link', { name: /bills/i })).toHaveAttribute('aria-current', 'page');
    expect(detailPane(container).getByText('Rent')).toBeInTheDocument();
    expect(detailPane(container).getByText('How this one closes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^rent/i })).toHaveAttribute('aria-current', 'true');
    expect(container.querySelector('.sheet.open')).toBeNull();
    expect(container.querySelector('.md-navbar')).toBeNull();
  });

  it('switches the detail pane when another bill or a loan is picked', async () => {
    const user = userEvent.setup();
    const { container } = renderBills();

    await user.click(screen.getByRole('button', { name: /thames water/i }));
    expect(detailPane(container).getByText('Meter fitted in May')).toBeInTheDocument();
    expect(detailPane(container).getByRole('button', { name: 'Edit this bill' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /takeaway/i }));
    expect(detailPane(container).getByText('Lent on 14 Sep')).toBeInTheDocument();
    expect(detailPane(container).getByRole('button', { name: 'Edit this' })).toBeInTheDocument();
  });

  it('keeps the detail pane on a bill the current filter still shows', async () => {
    const user = userEvent.setup();
    const { container } = renderBills();

    await user.click(screen.getByRole('button', { name: /takeaway/i }));
    await user.click(screen.getByRole('button', { name: 'Needs you' }));
    expect(screen.queryByRole('button', { name: /takeaway/i })).not.toBeInTheDocument();
    expect(detailPane(container).getByText('Rent')).toBeInTheDocument();
  });

  it('acts on the bill straight from the pane, with no Close button', async () => {
    const user = userEvent.setup();
    const { container, K } = renderBills();

    expect(detailPane(container).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.click(detailPane(container).getByRole('button', { name: /i’ve sent £700\.00/i }));
    expect(K.setStatus).toHaveBeenCalledWith('rent', 'sent');
  });

  it('keeps the edit form as a sheet', async () => {
    const user = userEvent.setup();
    const { container } = renderBills();

    await user.click(detailPane(container).getByRole('button', { name: 'Edit this bill' }));
    expect(container.querySelector('.sheet.open')).toHaveTextContent('Edit this bill');
    expect(screen.getByLabelText(/what is it\?/i)).toHaveValue('Rent');
  });
});
