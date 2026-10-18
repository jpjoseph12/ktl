import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DealCard from './DealCard';

const apiFetch = vi.fn();
const limit = vi.fn();
vi.mock('../lib/api', () => ({
  apiFetch: (...a) => apiFetch(...a),
  api: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: (...a) => limit(...a) }) }) }) }) }
}));
let info = { ai: true };
vi.mock('../lib/useServerInfo', () => ({ default: () => info }));

const BILL = { id: '11111111-1111-4111-8111-111111111111', name: 'Energy', renewsOn: '2099-01-31', renewalKind: 'energy' };
const RESULT = {
  summary: 'A fixed deal could save about £8 a month.',
  deals: [
    { provider: 'EDF', name: 'Fix 12', pricePerMonth: 88, url: 'https://www.edfenergy.com/t', foundInSearch: true },
    { provider: 'Other', name: 'Fix', pricePerMonth: 90, url: 'https://made-up.example/x', foundInSearch: false }
  ],
  tips: ['Ask your supplier to match it']
};

beforeEach(() => {
  info = { ai: true };
  apiFetch.mockReset();
  limit.mockReset().mockResolvedValue({ data: [] });
});

describe('DealCard', () => {
  it('shows when the deal ends and when the reminder comes', () => {
    render(<DealCard bill={BILL} shared />);
    expect(screen.getByText('Deal ends')).toBeInTheDocument();
    expect(screen.getByText('6 weeks before')).toBeInTheDocument();
  });

  it('asks for the end date when there isn’t one', async () => {
    const onAddDate = vi.fn();
    render(<DealCard bill={{ ...BILL, renewsOn: null }} onAddDate={onAddDate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add the date' }));
    expect(onAddDate).toHaveBeenCalled();
  });

  it('only offers a search when the server has an AI provider', () => {
    info = { ai: false };
    render(<DealCard bill={BILL} />);
    expect(screen.queryByRole('button', { name: /better deal/i })).not.toBeInTheDocument();
  });

  it('turns down something that isn’t a postcode area, without searching', async () => {
    render(<DealCard bill={BILL} />);
    await userEvent.type(screen.getByLabelText(/postcode area/i), '1234');
    await userEvent.click(screen.getByRole('button', { name: /better deal/i }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('searches a personal bill, waits for the answer and shows it — flagging links the search didn’t see', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetch
      .mockResolvedValueOnce({ job: 'j1', status: 'running' })
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', result: RESULT, checkedAt: '2026-10-18T10:00:00Z', model: 'claude-opus-5-5', kept: false });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DealCard bill={BILL} />);
    await user.type(screen.getByLabelText(/postcode area/i), 'm14');
    await user.click(screen.getByRole('button', { name: /better deal/i }));
    expect(apiFetch).toHaveBeenCalledWith('/api/deals/check', { method: 'POST', body: { area: 'm14', personalBillId: BILL.id } });
    expect(screen.getByRole('button', { name: /searching/i })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(apiFetch).toHaveBeenCalledWith('/api/deals/check/j1');
    expect(screen.getByText(RESULT.summary)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'edfenergy.com' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText(/double-check this link/)).toHaveLength(1);
    expect(screen.getByText(/only you see the result/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows the household the last check on a shared bill', async () => {
    limit.mockResolvedValue({ data: [{ checked_at: '2026-10-17T10:00:00Z', model: 'gpt-5.5', result: RESULT }] });
    render(<DealCard bill={BILL} shared />);
    expect(await screen.findByText(RESULT.summary)).toBeInTheDocument();
    expect(screen.getByText(/by gpt-5\.5/)).toBeInTheDocument();
  });

  it('says what went wrong', async () => {
    apiFetch.mockRejectedValueOnce(new Error('That’s 10 deal checks today — try again tomorrow.'));
    render(<DealCard bill={BILL} shared />);
    await userEvent.click(screen.getByRole('button', { name: /better deal/i }));
    expect(await screen.findByText(/10 deal checks today/)).toBeInTheDocument();
  });
});
