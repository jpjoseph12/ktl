import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SpendingReview, { forgetSpending } from './SpendingReview';

const HEADER = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In';
const line = (i, date, type, name, category, amount) => `tx_${i},${date},09:00:00,${type},${name},,${category},${amount},GBP,${amount},GBP,,,,${name},,,`;

const CSV = [
  HEADER,
  line(1, '05/07/2026', 'Card payment', 'Netflix', 'Entertainment', -10.99),
  line(2, '05/08/2026', 'Card payment', 'Netflix', 'Entertainment', -10.99),
  line(3, '05/09/2026', 'Card payment', 'Netflix', 'Entertainment', -10.99),
  line(4, '12/07/2026', 'Card payment', 'Spotify', 'Entertainment', -11.99),
  line(5, '12/08/2026', 'Card payment', 'Spotify', 'Entertainment', -11.99),
  line(6, '12/09/2026', 'Card payment', 'Spotify', 'Entertainment', -11.99),
  line(7, '02/09/2026', 'Card payment', 'Tesco', 'Groceries', -64.2),
  line(8, '03/09/2026', 'Pot transfer', 'Holiday', 'Savings', -50)
].join('\n');

function props(overrides = {}) {
  return {
    userId: 'me',
    tracked: ['Netflix'],
    debtOn: true,
    previewMonthsSaved: () => 2,
    onModel: vi.fn().mockResolvedValue(),
    onAddBill: vi.fn().mockResolvedValue(),
    ...overrides
  };
}

async function loadExport(user) {
  const file = new File([CSV], 'monzo.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('Choose a bank export'), file);
}

describe('SpendingReview', () => {
  afterEach(() => forgetSpending());

  it('promises the export stays on the device before anything is loaded', () => {
    render(<SpendingReview {...props()} />);
    expect(screen.getByText(/never uploaded, not even to KTL’s server/i)).toBeInTheDocument();
  });

  it('reads a Monzo export into a summary, findings and categories', async () => {
    const user = userEvent.setup();
    render(<SpendingReview {...props()} />);
    await loadExport(user);

    expect(await screen.findByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText('2 streaming subscriptions')).toBeInTheDocument();
    expect(screen.getByText('Where it goes')).toBeInTheDocument();
    expect(screen.getByText(/aren’t counted as spending/i)).toBeInTheDocument();
    // Netflix is already a bill in KTL, so only Spotify is "new"
    expect(screen.queryByText(/^Netflix — /)).not.toBeInTheDocument();
    expect(screen.getByText(/^Spotify — /)).toBeInTheDocument();
  });

  it('turns a regular payment into a bill of your own', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<SpendingReview {...p} />);
    await loadExport(user);

    await user.click((await screen.findAllByRole('button', { name: 'Add to my bills' }))[0]);
    expect(p.onAddBill).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String), day: expect.any(Number) }));
    expect(screen.getByText('Added')).toBeInTheDocument();
  });

  it('models a cut in Free up money', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<SpendingReview {...p} />);
    await loadExport(user);

    await user.click(await screen.findByRole('button', { name: '2 mo sooner' }));
    expect(p.onModel).toHaveBeenCalledWith(expect.objectContaining({ kind: 'overlap', monthly: 10.99 }));
  });

  it('never shows one person’s export to someone else on the same device', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SpendingReview {...props()} />);
    await loadExport(user);
    unmount();

    render(<SpendingReview {...props({ userId: 'someone-else' })} />);
    expect(screen.getByRole('button', { name: /choose a monzo export/i })).toBeInTheDocument();
  });

  it('explains a file that isn’t an export', async () => {
    const user = userEvent.setup();
    render(<SpendingReview {...props()} />);
    await user.upload(screen.getByLabelText('Choose a bank export'), new File(['a,b\n1,2'], 'x.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/doesn’t look like a bank export/)).toBeInTheDocument();
  });
});
