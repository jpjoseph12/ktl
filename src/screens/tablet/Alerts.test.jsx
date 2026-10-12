import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidAlerts from '../android/Alerts';
import { useKettle } from '../../context/KettleContext';

vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

const COUNCIL = {
  id: 'ct', name: 'Council Tax', glyph: 'landmark', status: 'payment-due', payer: 'partner', payerId: 'sam',
  total: 180, yourShare: 90, theirShare: 90, needsDetails: false, detailsYou: { done: true }, detailsPartner: { done: true }
};
const WIFI = {
  id: 'bb', name: 'Virgin Media', glyph: 'wifi', status: 'sent', payer: 'you', payerId: 'me',
  total: 38, yourShare: 19, theirShare: 19, needsDetails: false, detailsYou: { done: true }, detailsPartner: { done: true }
};

function kettle(overrides = {}) {
  return {
    you: { id: 'me', name: 'Alex', initials: 'A' },
    partner: { id: 'sam', name: 'Sam', initials: 'S' },
    others: [{ id: 'sam', name: 'Sam', initials: 'S' }],
    data: {
      household: { name: 'Flat 4', code: 'ABC-1234', payoutRef: 'FLAT4' },
      reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00', nudgeAfter: 24 },
      activity: [],
      people: { me: { name: 'Alex', initials: 'A' }, sam: { name: 'Sam', initials: 'S' } },
      scheduled: [{ kind: 'payment', title: 'Rent reminder', sub: 'Rent · £700.00', at: '29 Sep, 18:00' }]
    },
    all: () => [COUNCIL, WIFI],
    tracking: () => false,
    needsYou: () => [{ type: 'pay', item: COUNCIL }, { type: 'confirm', item: WIFI }],
    closedStatus: () => 'sent',
    setStatus: vi.fn().mockResolvedValue(undefined),
    setFlag: vi.fn().mockResolvedValue(undefined),
    snoozeItem: vi.fn(),
    openCount: () => 2,
    ...overrides
  };
}

function renderAlerts(K = kettle()) {
  useKettle.mockReturnValue(K);
  const utils = render(
    <MemoryRouter>
      <AndroidAlerts />
    </MemoryRouter>
  );
  return { ...utils, K, pane: within(utils.container.querySelector('.tablet-detail-pane')) };
}

describe('Alerts at tablet width', () => {
  const realMatchMedia = window.matchMedia;

  beforeEach(() => {
    useKettle.mockReset();
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('shows how the reminders work until an alert is picked, with Alerts current in the sidebar', () => {
    const { pane } = renderAlerts();

    expect(screen.getByRole('link', { name: /alerts/i })).toHaveAttribute('aria-current', 'page');
    expect(pane.getByText('How KTL chases you')).toBeInTheDocument();
    expect(pane.getByText('Select any item on the left to confirm or act on it.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reminder settings/i })).toBeInTheDocument();
  });

  it('acts on a picked alert straight from the pane, without a dialog', async () => {
    const user = userEvent.setup();
    const { container, pane, K } = renderAlerts();

    await user.click(screen.getByRole('button', { name: /send £90\.00 to sam/i }));
    expect(pane.getByText('FLAT4')).toBeInTheDocument();
    await user.click(pane.getByRole('button', { name: /i’ve sent £90\.00/i }));

    expect(K.setStatus).toHaveBeenCalledWith('ct', 'sent', 'Marked £90.00 for Council Tax');
    expect(container.querySelector('.md-dialog')).toBeNull();
    expect(await screen.findByText('Sam has been told your £90.00 is on the way.')).toBeInTheDocument();
  });

  it('snoozes the picked alert from the pane', async () => {
    const user = userEvent.setup();
    const { pane, K } = renderAlerts();

    await user.click(screen.getByRole('button', { name: /confirm £19\.00 arrived/i }));
    await user.click(pane.getByRole('button', { name: 'Snooze' }));
    expect(K.snoozeItem).toHaveBeenCalledWith('confirm', 'bb');
  });

  it('says when nothing needs you, with the next reminder', () => {
    const { pane } = renderAlerts(kettle({ needsYou: () => [] }));

    expect(pane.getByText('Nothing needs you right now. Next reminder: 29 Sep, 18:00.')).toBeInTheDocument();
  });
});
