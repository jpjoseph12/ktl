import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidYours from '../android/Yours';
import { useKettle } from '../../context/KettleContext';
import { usePrivate } from '../../context/PrivateContext';
import { useWalkthrough } from '../../context/WalkthroughContext';

vi.mock('../../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../../context/PrivateContext', () => ({ usePrivate: vi.fn() }));
vi.mock('../../context/WalkthroughContext', () => ({ useWalkthrough: vi.fn() }));

const SAM = { id: 'sam', name: 'Sam', initials: 'S' };

function kettle() {
  return {
    you: { id: 'me', name: 'Alex', initials: 'A' },
    partner: SAM,
    others: [SAM],
    data: { household: { name: 'Flat 4', code: 'ABC-1234' }, bills: [], lending: [] },
    balance: () => ({ youOwe: 90, theyOwe: 0, net: 90, inFlightToYou: 0, inFlightFromYou: 0 }),
    openCount: () => 0,
    refreshNow: vi.fn()
  };
}

function priv({ debtModule = true } = {}) {
  return {
    state: {
      income: 2400, payday: '28th', budget: 300, strategy: 'avalanche', debtModule,
      debts: [{ id: 'd1', name: 'Barclaycard' }],
      personal: [{ id: 'p1', name: 'EE mobile', amount: 28, day: 3, glyph: 'phone', kind: 'Phone' }],
      savings: [{ id: 's1', label: 'Gym', detail: 'Cancel the gym', amount: 30, applied: false }]
    },
    leftover: () => ({ left: 1210, weekly: 279, income: 2400, household: 890, personal: 28, debt: 272, pctHousehold: 37, pctPersonal: 1, pctDebt: 11 }),
    payoffPlan: () => ({
      rows: [{ id: 'd1', rank: 1, isFocus: true, glyph: 'card', name: 'Barclaycard', min: 62, balance: 2480, dateShort: 'Mar 27', rate: { band: 'high', label: '24.9% APR', monthly: 51, cost: '£51/mo interest' } }],
      freeDate: 'March 2027', months: 18, stalled: false, totalOwed: 2480, progressPct: 20, compareLine: '4 months sooner than minimums alone',
      warning: null, interest: 420, working: 300, freed: 0, minTotal: 62
    }),
    emergencyFund: () => ({ saved: 1500, target: 3600, months: 3, progressPct: 42, monthlyOutgoings: 1190, coveredMonths: 1.3, remaining: 2100 }),
    personalSorted: () => [{ id: 'p1', name: 'EE mobile', amount: 28, day: 3, glyph: 'phone', kind: 'Phone' }],
    subscriptionSuggestions: () => [],
    daysSincePayday: () => null,
    previewMonthsSaved: () => 2,
    debtBudgetWarning: () => null,
    ordinal: (n) => `${n}rd`,
    glyphFor: () => 'card',
    kindFor: () => 'Other',
    rateInfo: () => ({ band: 'zero', label: '0% APR', detail: '' }),
    standardAprFor: () => null,
    num: Number,
    visibility: { shared: ['Your share of the household bills'], never: ['Your pay'] },
    set: vi.fn(),
    toggleSaving: vi.fn(),
    refreshNow: vi.fn()
  };
}

function renderYours({ M = priv(), step = null } = {}) {
  useKettle.mockReturnValue(kettle());
  usePrivate.mockReturnValue(M);
  useWalkthrough.mockReturnValue({ targetRef: () => () => {}, step });
  const utils = render(<MemoryRouter><AndroidYours /></MemoryRouter>);
  return { ...utils, pane: () => within(utils.container.querySelector('.tablet-detail-pane')) };
}

describe('Yours at phone width (unchanged by the tablet layout)', () => {
  beforeEach(() => { useKettle.mockReset(); usePrivate.mockReset(); });

  it('still stacks every section in one scroll with the bottom nav', () => {
    const { container } = renderYours();

    expect(container.querySelector('.tablet-shell')).toBeNull();
    expect(container.querySelector('.md-navbar')).not.toBeNull();
    const scroll = within(container.querySelector('.scroll'));
    expect(scroll.getByText('Emergency fund')).toBeInTheDocument();
    expect(scroll.getByRole('heading', { name: 'Your own bills' })).toBeInTheDocument();
    expect(scroll.getByText('March 2027')).toBeInTheDocument();
    expect(scroll.getByText('Free up money')).toBeInTheDocument();
  });
});

describe('Yours at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    usePrivate.mockReset();
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('opens on what’s left, and shows the visibility list from the topbar', async () => {
    const user = userEvent.setup();
    const { container, pane } = renderYours();

    expect(screen.getByRole('link', { name: /yours/i })).toHaveAttribute('aria-current', 'page');
    expect(pane().getByText(/left to live on each month/)).toBeInTheDocument();
    expect(pane().getByText('Due to Sam right now')).toBeInTheDocument();
    expect(pane().queryByText('March 2027')).not.toBeInTheDocument();

    await user.click(within(container.querySelector('.tablet-topbar')).getByRole('button', { name: /what sam can see/i }));
    expect(container.querySelector('.sheet.open')).toHaveTextContent('What Sam can see');
  });

  it('shows one area at a time as categories are picked', async () => {
    const user = userEvent.setup();
    const { pane } = renderYours();
    const nav = within(screen.getByRole('navigation', { name: 'Your private space' }));

    await user.click(nav.getByRole('button', { name: 'Debt repayment' }));
    expect(pane().getByText('March 2027')).toBeInTheDocument();
    expect(pane().getByText('Barclaycard')).toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: 'Free up money' }));
    expect(pane().getByText('Gym')).toBeInTheDocument();

    await user.click(nav.getByRole('button', { name: 'Emergency fund' }));
    expect(pane().getByText('£1,500.00')).toBeInTheDocument();
  });

  it('explains debt repayment is off instead of showing savings when the module is off', async () => {
    const user = userEvent.setup();
    const { pane } = renderYours({ M: priv({ debtModule: false }) });

    await user.click(screen.getByRole('button', { name: 'Free up money' }));
    expect(pane().getByText('Debt repayment is off')).toBeInTheDocument();
    expect(pane().queryByText('Gym')).not.toBeInTheDocument();
  });

  it('moves to the category holding the walkthrough’s current target', () => {
    const { pane } = renderYours({ step: { target: 'add-personal-bill' } });

    expect(pane().getByText('EE mobile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Your own bills' })).toHaveAttribute('aria-current', 'true');
  });
});
