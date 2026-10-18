import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidBills from './Bills';
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
const SAM = { id: 'partner-1', name: 'Sam', initials: 'S' };

function baseKettle(overrides = {}) {
  return {
    you: YOU,
    partner: SAM,
    members: [YOU, SAM],
    others: [SAM],
    data: {
      household: { split: '50% each' },
      people: { [YOU.id]: YOU, [SAM.id]: SAM },
      bills: [],
      lending: [],
      reminders: { paymentLead: 2, paymentTime: '18:00', detailsLead: 5, detailsTime: '09:00' }
    },
    cycleTotals: () => ({ total: 0, paidOut: 0, closed: 0, count: 0 }),
    find: () => null,
    labelOf: () => '',
    detailsIn: () => false,
    statusOf: (item) => item.status,
    openCount: () => 0,
    addBill: vi.fn().mockResolvedValue(undefined),
    updateBill: vi.fn().mockResolvedValue(undefined),
    removeBill: vi.fn().mockResolvedValue(undefined),
    addLending: vi.fn().mockResolvedValue(undefined),
    updateLending: vi.fn().mockResolvedValue(undefined),
    removeLending: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderBills(kettleOverrides) {
  useKettle.mockReturnValue(baseKettle(kettleOverrides));
  render(
    <MemoryRouter>
      <AndroidBills />
    </MemoryRouter>
  );
}

async function openAddSheet(user) {
  await user.click(screen.getByRole('button', { name: /add a cost/i }));
  await user.click(screen.getByRole('button', { name: /recurring cost/i }));
}

async function fillRequiredFields(user) {
  await user.type(screen.getByLabelText(/what is it\?/i), 'Council Tax');
  await user.type(screen.getByLabelText(/amount each time/i), '93.00');
}

describe('AndroidBills — per-bill split override', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('defaults to the equal split with no custom input shown', async () => {
    const user = userEvent.setup();
    renderBills();
    await openAddSheet(user);

    expect(screen.getByRole('tab', { name: /equal \(50% each\)/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText(/your share as a percentage/i)).not.toBeInTheDocument();
  });

  it('hides the split control entirely when there is no one else in the household', async () => {
    const user = userEvent.setup();
    renderBills({ partner: null, others: [], members: [YOU] });
    await openAddSheet(user);

    expect(screen.queryByText(/how should this one be split\?/i)).not.toBeInTheDocument();
  });

  it('submits splitPercents with you at 100 when "One pays it all" defaults to you', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('tab', { name: /one pays it all/i }));
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({
      payerId: 'me',
      splitPercents: { me: 100, 'partner-1': 0 }
    }));
  });

  it('submits splitPercents with the chosen member at 100 when "One pays it all" is reassigned', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('tab', { name: /one pays it all/i }));
    await user.selectOptions(screen.getByLabelText(/who covers it all/i), 'partner-1');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({
      splitPercents: { me: 0, 'partner-1': 100 }
    }));
  });

  it('submits a valid custom percentage split', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('tab', { name: /custom %/i }));
    const yourPct = screen.getByLabelText(/your share as a percentage/i);
    const samPct = screen.getByLabelText(/sam’s share as a percentage/i);
    await user.clear(yourPct);
    await user.type(yourPct, '70');
    await user.clear(samPct);
    await user.type(samPct, '30');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ splitPercents: { me: 70, 'partner-1': 30 } }));
  });

  it('rejects a custom split that does not add up to 100 and does not submit', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('tab', { name: /custom %/i }));
    const yourPct = screen.getByLabelText(/your share as a percentage/i);
    await user.clear(yourPct);
    await user.type(yourPct, '90');

    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).not.toHaveBeenCalled();
    expect(yourPct.closest('.field')).toHaveClass('invalid');
  });

  it('does not send a splitPercents override for the equal split', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ splitPercents: undefined }));
  });

  it('lets you choose who pays the provider from every household member', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);

    await user.selectOptions(screen.getByLabelText(/who pays the provider\?/i), 'partner-1');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ payerId: 'partner-1' }));
  });

  it('still resolves to the equal default with a 3-person household', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    const RILEY = { id: 'riley-1', name: 'Riley', initials: 'R' };
    renderBills({ addBill, members: [YOU, SAM, RILEY], others: [SAM, RILEY] });
    await openAddSheet(user);
    await fillRequiredFields(user);

    expect(screen.getByRole('tab', { name: /equal/i })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ splitPercents: undefined }));
  });

  it('shows the resolved split on an existing bill’s detail sheet', async () => {
    const user = userEvent.setup();
    const bill = {
      id: 'b1', name: 'Council Tax', glyph: 'card', total: 100, yourShare: 70, theirShare: 30,
      payer: 'you', payerId: 'me', shares: { me: 70, 'partner-1': 30 }, details: {},
      due: '10th', status: 'scheduled', needsDetails: false
    };
    renderBills({ data: { ...baseKettle().data, bills: [bill] }, find: () => bill });

    await user.click(screen.getByRole('button', { name: /council tax/i }));

    const dialog = screen.getByRole('dialog', { name: /council tax/i });
    expect(within(dialog).getByText(/70% you/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/30% sam/i)).toBeInTheDocument();
  });
});

describe('AndroidBills — edit and remove a shared bill', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function billFixture(overrides = {}) {
    return {
      id: 'b1', name: 'Netflix', glyph: 'play', total: 100, yourShare: 50, theirShare: 50,
      payer: 'you', payerId: 'me', shares: { me: 50, 'partner-1': 50 }, details: {},
      due: '10th', dueSort: '2026-10-10', status: 'scheduled', needsDetails: false,
      ...overrides
    };
  }

  it('shows an edit entry point for a recurring bill but not for a lending item', async () => {
    const user = userEvent.setup();
    const bill = billFixture();
    const lending = {
      id: 'l1', name: 'Loaned for concert tickets', total: 40, yourShare: 40, theirShare: 0,
      payer: 'you', payerId: 'me', shares: { me: 40 }, details: {}, date: '1 Sep', status: 'payment-due'
    };
    renderBills({
      data: { ...baseKettle().data, bills: [bill], lending: [lending] },
      find: (id) => (id === bill.id ? bill : id === lending.id ? lending : null)
    });

    await user.click(screen.getByRole('button', { name: /netflix/i }));
    expect(within(screen.getByRole('dialog', { name: /netflix/i })).getByRole('button', { name: /edit this bill/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));

    await user.click(screen.getByRole('button', { name: /loaned for concert tickets/i }));
    expect(within(screen.getByRole('dialog', { name: /loaned for concert tickets/i })).queryByRole('button', { name: /edit this bill/i })).not.toBeInTheDocument();
  });

  it('pre-fills the form and calls updateBill with the edited values', async () => {
    const user = userEvent.setup();
    const bill = billFixture();
    const updateBill = vi.fn().mockResolvedValue(undefined);
    renderBills({
      data: { ...baseKettle().data, bills: [bill] },
      find: () => bill,
      updateBill
    });

    await user.click(screen.getByRole('button', { name: /netflix/i }));
    await user.click(screen.getByRole('button', { name: /edit this bill/i }));

    expect(screen.getByRole('heading', { name: /edit this bill/i })).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/what is it\?/i);
    expect(nameInput).toHaveValue('Netflix');
    await user.clear(nameInput);
    await user.type(nameInput, 'Netflix Premium');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(updateBill).toHaveBeenCalledWith('b1', expect.objectContaining({ name: 'Netflix Premium', total: 100, payerId: 'me' }));
  });

  it('calls removeBill when "Remove this bill" is confirmed from the edit form', async () => {
    const user = userEvent.setup();
    const bill = billFixture();
    const removeBill = vi.fn().mockResolvedValue(undefined);
    renderBills({
      data: { ...baseKettle().data, bills: [bill] },
      find: () => bill,
      removeBill
    });

    await user.click(screen.getByRole('button', { name: /netflix/i }));
    await user.click(screen.getByRole('button', { name: /edit this bill/i }));
    await user.click(screen.getByRole('button', { name: /remove this bill/i }));

    expect(removeBill).toHaveBeenCalledWith('b1');
  });

  it('resets to a blank add form after cancelling an edit', async () => {
    const user = userEvent.setup();
    const bill = billFixture();
    renderBills({ data: { ...baseKettle().data, bills: [bill] }, find: () => bill });

    await user.click(screen.getByRole('button', { name: /netflix/i }));
    await user.click(screen.getByRole('button', { name: /edit this bill/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await openAddSheet(user);
    expect(screen.getByRole('heading', { name: /add a recurring cost/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what is it\?/i)).toHaveValue('');
  });
});

describe('AndroidBills — dismissible streaming-overlap notice', () => {
  beforeEach(() => {
    useKettle.mockReset();
    localStorage.clear();
  });

  function streamingBills() {
    return [
      { id: 's1', name: 'Netflix', glyph: 'play', total: 10, yourShare: 5, theirShare: 5, payer: 'you', payerId: 'me', due: '1st', status: 'scheduled' },
      { id: 's2', name: 'Spotify', glyph: 'music', total: 10, yourShare: 5, theirShare: 5, payer: 'you', payerId: 'me', due: '1st', status: 'scheduled' }
    ];
  }

  it('dismisses the notice and it stays gone on a fresh render with the same bills', async () => {
    const user = userEvent.setup();
    renderBills({ data: { ...baseKettle().data, bills: streamingBills() } });

    expect(screen.getByText(/splits 2 streaming services/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/splits 2 streaming services/i)).not.toBeInTheDocument();

    renderBills({ data: { ...baseKettle().data, bills: streamingBills() } });
    expect(screen.queryByText(/splits 2 streaming services/i)).not.toBeInTheDocument();
  });

  it('reappears once a new overlapping bill changes the set', async () => {
    const user = userEvent.setup();
    renderBills({ data: { ...baseKettle().data, bills: streamingBills() } });

    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/splits 2 streaming services/i)).not.toBeInTheDocument();

    const withNewBill = [...streamingBills(), { id: 's3', name: 'Disney Plus', glyph: 'play', total: 8, yourShare: 4, theirShare: 4, payer: 'you', payerId: 'me', due: '1st', status: 'scheduled' }];
    renderBills({ data: { ...baseKettle().data, bills: withNewBill } });

    expect(screen.getByText(/splits 3 streaming services/i)).toBeInTheDocument();
  });
});

describe('AndroidBills — soonest-due-first ordering and "show more"', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function billsDueOn(...days) {
    return days.map((day, i) => ({
      id: 'b' + i, name: 'Bill ' + day, glyph: 'card', total: 10, yourShare: 5, theirShare: 5,
      payer: 'you', payerId: 'me', due: day + '', dueSort: `2026-09-${String(day).padStart(2, '0')}`, status: 'scheduled'
    }));
  }

  it('lists bills soonest-due first regardless of insertion order', () => {
    const bills = billsDueOn(20, 5, 15);
    renderBills({ data: { ...baseKettle().data, bills } });

    const names = screen.getAllByText(/^Bill \d+$/).map((el) => el.textContent);
    expect(names).toEqual(['Bill 5', 'Bill 15', 'Bill 20']);
  });

  it('caps the list at 6 with a "Show more" button, sorted, expanding to reveal the rest', async () => {
    const user = userEvent.setup();
    const bills = billsDueOn(9, 8, 7, 6, 5, 4, 3, 2);
    renderBills({ data: { ...baseKettle().data, bills } });

    expect(screen.getAllByText(/^Bill \d+$/)).toHaveLength(6);
    expect(screen.getByRole('button', { name: /show 2 more/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show 2 more/i }));

    const names = screen.getAllByText(/^Bill \d+$/).map((el) => el.textContent);
    expect(names).toEqual(['Bill 2', 'Bill 3', 'Bill 4', 'Bill 5', 'Bill 6', 'Bill 7', 'Bill 8', 'Bill 9']);
    expect(screen.queryByRole('button', { name: /show.*more/i })).not.toBeInTheDocument();
  });
});

describe('AndroidBills — add money lent (a one-off, owed in full by one person)', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  async function openLendSheet(user) {
    await user.click(screen.getByRole('button', { name: /add money lent/i }));
  }

  it('defaults to you as payer and the other member as borrower, and adds it', async () => {
    const user = userEvent.setup();
    const addLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ addLending });
    await openLendSheet(user);

    await user.type(screen.getByLabelText(/what was it for\?/i), 'Takeaway');
    await user.type(screen.getByLabelText(/amount \(£\)/i), '18.50');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(addLending).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Takeaway', total: 18.5, payerId: 'me', borrowerId: 'partner-1', borrowerPct: 100
    }));
  });

  it('sends borrowerPct: 50 when "Half each" is chosen, to actually halve the maths', async () => {
    const user = userEvent.setup();
    const addLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ addLending });
    await openLendSheet(user);

    await user.type(screen.getByLabelText(/what was it for\?/i), 'Takeaway');
    await user.type(screen.getByLabelText(/amount \(£\)/i), '40');
    await user.click(screen.getByRole('tab', { name: /half each/i }));
    expect(screen.getByText(/sam owes £20\.00, and £20\.00 is your own cost/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(addLending).toHaveBeenCalledWith(expect.objectContaining({ borrowerPct: 50 }));
  });

  it('opens from the "Add a cost" FAB chooser alongside recurring costs', async () => {
    const user = userEvent.setup();
    const addLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ addLending });

    await user.click(screen.getByRole('button', { name: /^add a cost$/i }));
    await user.click(screen.getByRole('button', { name: /^money lent/i }));
    expect(screen.getByRole('heading', { name: /add money lent/i })).toBeInTheDocument();
  });

  it('bumps the borrower away from whoever is newly selected as payer', async () => {
    const user = userEvent.setup();
    const addLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ addLending });
    await openLendSheet(user);

    await user.type(screen.getByLabelText(/what was it for\?/i), 'Petrol');
    await user.type(screen.getByLabelText(/amount \(£\)/i), '20');
    await user.selectOptions(screen.getByLabelText(/who paid\?/i), 'partner-1');
    // borrower can no longer be Sam once Sam is the payer — should have bumped to "You"
    expect(screen.getByLabelText(/who owes it back\?/i)).toHaveValue('me');

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(addLending).toHaveBeenCalledWith(expect.objectContaining({ payerId: 'partner-1', borrowerId: 'me' }));
  });

  it('does not submit without a name and amount', async () => {
    const user = userEvent.setup();
    const addLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ addLending });
    await openLendSheet(user);

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(addLending).not.toHaveBeenCalled();
  });

  it('is disabled with a hint when there is nobody else in the household', async () => {
    const user = userEvent.setup();
    renderBills({ partner: null, others: [], members: [YOU] });
    await openLendSheet(user);

    expect(screen.getByText(/invite someone to your household first/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
  });
});

describe('AndroidBills — edit and remove a money-lent entry', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function lendingFixture(overrides = {}) {
    return {
      id: 'l1', name: 'Takeaway', glyph: 'cart', total: 40, yourShare: 0, theirShare: 40,
      payer: 'you', payerId: 'me', shares: { 'partner-1': 40 }, details: {},
      date: '1 Sep', status: 'payment-due', note: null,
      ...overrides
    };
  }

  it('pre-fills "All of it" for a full-amount loan and calls updateLending on save', async () => {
    const user = userEvent.setup();
    const item = lendingFixture();
    const updateLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ data: { ...baseKettle().data, lending: [item] }, find: () => item, updateLending });

    await user.click(screen.getByRole('button', { name: /takeaway/i }));
    await user.click(screen.getByRole('button', { name: /edit this/i }));

    expect(screen.getByRole('heading', { name: /^edit this$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/what was it for\?/i)).toHaveValue('Takeaway');
    expect(screen.getByLabelText(/amount \(£\)/i)).toHaveValue('40');
    expect(screen.getByRole('tab', { name: /^all of it$/i })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(updateLending).toHaveBeenCalledWith('l1', expect.objectContaining({ name: 'Takeaway', total: 40, borrowerPct: 100 }));
  });

  it('pre-fills "Half each" when the payer already holds their own half-share', async () => {
    const user = userEvent.setup();
    const item = lendingFixture({ shares: { me: 20, 'partner-1': 20 } });
    renderBills({ data: { ...baseKettle().data, lending: [item] }, find: () => item });

    await user.click(screen.getByRole('button', { name: /takeaway/i }));
    await user.click(screen.getByRole('button', { name: /edit this/i }));

    expect(screen.getByRole('tab', { name: /half each/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('calls removeLending when "Remove this" is confirmed from the edit sheet', async () => {
    const user = userEvent.setup();
    const item = lendingFixture();
    const removeLending = vi.fn().mockResolvedValue(undefined);
    renderBills({ data: { ...baseKettle().data, lending: [item] }, find: () => item, removeLending });

    await user.click(screen.getByRole('button', { name: /takeaway/i }));
    await user.click(screen.getByRole('button', { name: /edit this/i }));
    await user.click(screen.getByRole('button', { name: /remove this/i }));

    expect(removeLending).toHaveBeenCalledWith('l1');
  });
});

describe('AndroidBills — ending a bill keeps its history', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function endableBill(overrides = {}) {
    return {
      id: 'b1', name: 'Netflix', glyph: 'play', total: 100, yourShare: 50, theirShare: 50,
      payer: 'you', payerId: 'me', shares: { me: 50, 'partner-1': 50 }, details: {},
      due: '10th', dueSort: '2026-10-10', status: 'scheduled', needsDetails: false,
      endedOn: null, ...overrides
    };
  }

  it('offers "End this bill" rather than only destroying it', async () => {
    const user = userEvent.setup();
    const b = endableBill();
    const endBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b, endBill });

    await user.click(screen.getByRole('button', { name: /netflix/i }));
    await user.click(screen.getByRole('button', { name: /edit this bill/i }));
    await user.click(screen.getByRole('button', { name: /end this bill/i }));

    expect(endBill).toHaveBeenCalledWith('b1');
  });

  it('keeps an ended bill out of the running list', () => {
    const b = endableBill({ endedOn: '2026-09-30' });
    renderBills({ data: { ...baseKettle().data, bills: [b] } });
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('surfaces it under the Ended filter, marked as ended', async () => {
    const user = userEvent.setup();
    const b = endableBill({ endedOn: '2026-09-30' });
    renderBills({ data: { ...baseKettle().data, bills: [b] } });

    await user.click(screen.getByRole('button', { name: /^ended$/i }));
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText(/ended 30 sep/i)).toBeInTheDocument();
  });

  it('offers to restart one that has already ended', async () => {
    const user = userEvent.setup();
    const b = endableBill({ endedOn: '2026-09-30' });
    const reopenBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b, reopenBill });

    await user.click(screen.getByRole('button', { name: /^ended$/i }));
    await user.click(screen.getByRole('button', { name: /netflix/i }));
    await user.click(screen.getByRole('button', { name: /edit this bill/i }));
    await user.click(screen.getByRole('button', { name: /start it up again/i }));

    expect(reopenBill).toHaveBeenCalledWith('b1');
  });
});

describe('AndroidBills — refunds go in as negative amounts', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('accepts a negative amount and passes it through as a credit', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);

    await user.type(screen.getByLabelText(/what is it\?/i), 'Energy refund');
    await user.type(screen.getByLabelText(/amount each time/i), '-60');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ total: -60 }));
  });

  it('explains that a negative is a credit while you are typing it', async () => {
    const user = userEvent.setup();
    renderBills();
    await openAddSheet(user);

    await user.type(screen.getByLabelText(/amount each time/i), '-60');
    expect(screen.getByText(/money coming back/i)).toBeInTheDocument();
  });

  it('still rejects a zero or non-numeric amount', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);

    await user.type(screen.getByLabelText(/what is it\?/i), 'Nonsense');
    await user.type(screen.getByLabelText(/amount each time/i), '0');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));

    expect(addBill).not.toHaveBeenCalled();
  });
});

describe('AndroidBills — recording part of a payment', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function owedBill(overrides = {}) {
    return {
      id: 'b1', name: 'Rent', glyph: 'home', total: 100, yourShare: 50, theirShare: 50,
      yourOutstanding: 50, payer: 'partner', payerId: 'partner-1',
      shares: { me: 50, 'partner-1': 50 }, paid: {}, outstanding: { me: 50, 'partner-1': 0 },
      details: {}, due: '10th', dueSort: '2026-10-10', status: 'payment-due', needsDetails: false,
      ...overrides
    };
  }

  it('offers a part-payment alongside paying the lot', async () => {
    const user = userEvent.setup();
    const b = owedBill();
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b });

    await user.click(screen.getByRole('button', { name: /rent/i }));
    expect(screen.getByRole('button', { name: /only sent part of it/i })).toBeInTheDocument();
  });

  it('records the amount against your share', async () => {
    const user = userEvent.setup();
    const b = owedBill();
    const recordPayment = vi.fn().mockResolvedValue({ closed: false });
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b, recordPayment });

    await user.click(screen.getByRole('button', { name: /rent/i }));
    await user.click(screen.getByRole('button', { name: /only sent part of it/i }));
    await user.type(screen.getByLabelText(/how much have you sent/i), '20');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    expect(recordPayment).toHaveBeenCalledWith('b1', 'me', 20);
  });

  it('refuses more than is actually outstanding', async () => {
    const user = userEvent.setup();
    const b = owedBill();
    const recordPayment = vi.fn().mockResolvedValue({ closed: false });
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b, recordPayment });

    await user.click(screen.getByRole('button', { name: /rent/i }));
    await user.click(screen.getByRole('button', { name: /only sent part of it/i }));
    await user.type(screen.getByLabelText(/how much have you sent/i), '80');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    expect(recordPayment).not.toHaveBeenCalled();
  });
});

describe('AndroidBills — variable bills record what they actually came to', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  function variableBill(overrides = {}) {
    return {
      id: 'b1', name: 'Octopus Energy', glyph: 'bolt', total: 80, yourShare: 40, theirShare: 40,
      yourOutstanding: 40, payer: 'you', payerId: 'me',
      shares: { me: 40, 'partner-1': 40 }, paid: {}, outstanding: { me: 40, 'partner-1': 40 },
      details: {}, due: '10th', dueSort: '2026-10-10', status: 'scheduled',
      needsDetails: true, detailsLabel: 'Meter reading', amountHistory: [],
      ...overrides
    };
  }

  it('offers to set the real amount on a bill that needs details', async () => {
    const user = userEvent.setup();
    const b = variableBill();
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b });

    await user.click(screen.getByRole('button', { name: /octopus energy/i }));
    expect(screen.getByRole('button', { name: /set what it came to/i })).toBeInTheDocument();
  });

  it('does not offer it on a fixed bill, which has nothing variable to record', async () => {
    const user = userEvent.setup();
    const b = variableBill({ needsDetails: false });
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b });

    await user.click(screen.getByRole('button', { name: /octopus energy/i }));
    expect(screen.queryByRole('button', { name: /set what it came to/i })).not.toBeInTheDocument();
  });

  it('records the new figure', async () => {
    const user = userEvent.setup();
    const b = variableBill();
    const recordBillAmount = vi.fn().mockResolvedValue(undefined);
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b, recordBillAmount });

    await user.click(screen.getByRole('button', { name: /octopus energy/i }));
    await user.click(screen.getByRole('button', { name: /set what it came to/i }));
    const field = screen.getByLabelText(/what it came to this time/i);
    await user.clear(field);
    await user.type(field, '112.40');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    expect(recordBillAmount).toHaveBeenCalledWith('b1', 112.4);
  });

  it('shows what it came to in previous cycles', async () => {
    const user = userEvent.setup();
    const b = variableBill({
      amountHistory: [
        { id: 'a1', amount: 112.4, forDate: '2026-10-01', note: null },
        { id: 'a2', amount: 84.15, forDate: '2026-09-01', note: null }
      ]
    });
    renderBills({ data: { ...baseKettle().data, bills: [b] }, find: () => b });

    await user.click(screen.getByRole('button', { name: /octopus energy/i }));
    await user.click(screen.getByRole('button', { name: /set what it came to/i }));

    // Scoped to the sheet: the detail view behind it also shows "Last time".
    const sheet = screen.getByRole('dialog', { name: /what did it come to\?/i });
    expect(within(sheet).getByText(/what it has come to before/i)).toBeInTheDocument();
    expect(within(sheet).getByText('£84.15')).toBeInTheDocument();
  });
});

describe('AndroidBills — when the deal ends', () => {
  beforeEach(() => { useKettle.mockReset(); });

  it('saves the end date with a kind worked out from the name, and says when the reminder comes', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await user.type(screen.getByLabelText(/what is it\?/i), 'Octopus Energy');
    await user.type(screen.getByLabelText(/amount each time/i), '96.00');
    fireEvent.change(screen.getByLabelText(/when does the deal end/i), { target: { value: '2027-03-31' } });
    expect(screen.getByText(/remind you 6 weeks before/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what kind of deal/i)).toHaveDisplayValue('Work it out (energy)');
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));
    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ renewsOn: '2027-03-31', renewalKind: 'energy' }));
  });

  it('leaves both empty when there’s no end date', async () => {
    const user = userEvent.setup();
    const addBill = vi.fn().mockResolvedValue(undefined);
    renderBills({ addBill });
    await openAddSheet(user);
    await fillRequiredFields(user);
    expect(screen.queryByLabelText(/what kind of deal/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add and start reminders/i }));
    expect(addBill).toHaveBeenCalledWith(expect.objectContaining({ renewsOn: null, renewalKind: null }));
  });
});
