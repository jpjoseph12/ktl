import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PeopleCard from './PeopleCard';
import { ScreenProvider } from '../../context/ScreenContext';

const apiFetch = vi.fn();
vi.mock('../../lib/api', () => ({ apiFetch: (...args) => apiFetch(...args), SERVER_URL: 'https://ktl.example.com', IS_NATIVE: false, clearServer: vi.fn(), accountNeedsPassword: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'Alex Rivera', email: 'alex@example.com', role: 'owner', hasPassword: true, inHousehold: true };
const sam = { id: '22222222-2222-4222-8222-222222222222', name: 'Sam', email: 'sam@example.com', role: 'member', hasPassword: false, inHousehold: true };
const stray = { id: '33333333-3333-4333-8333-333333333333', name: 'Old account', email: 'old@example.com', role: null, hasPassword: true, inHousehold: false };

function admin(people = [owner, sam]) {
  return { data: { people, maxPeople: 6 }, reload: vi.fn().mockResolvedValue() };
}

const renderCard = (a) => render(<ScreenProvider><PeopleCard admin={a} /></ScreenProvider>);

describe('PeopleCard — who’s on this server', () => {
  it('adds someone and hands back an invite to send, with when it runs out', async () => {
    const user = userEvent.setup();
    const invite = { link: 'https://ktl.example.com/join#tok', expiresAt: '2026-10-21T12:00:00Z', message: 'Alex has invited you to Flat 4 on KTL… https://ktl.example.com/join#tok' };
    apiFetch.mockResolvedValueOnce({ person: { id: sam.id, name: 'Sam', email: 'sam@example.com' }, invite });
    const a = admin([owner, sam]);
    renderCard(a);

    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('tab', { name: '7 days' }));
    await user.click(screen.getByRole('button', { name: /add and make an invite/i }));

    expect(apiFetch).toHaveBeenCalledWith('/api/admin/people', { method: 'POST', body: { name: 'Sam', email: 'sam@example.com', expiresIn: '7d' } });
    expect(a.reload).toHaveBeenCalled();
    expect(await screen.findByText(/has invited you to Flat 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('never offers to remove the owner, and asks before removing anyone else', async () => {
    const user = userEvent.setup();
    apiFetch.mockResolvedValueOnce({ removed: true });
    const a = admin();
    renderCard(a);

    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByText(/their account and everything private to them are deleted/i).closest('.hint');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));

    expect(apiFetch).toHaveBeenCalledWith(`/api/admin/people/${sam.id}`, { method: 'DELETE' });
  });

  it('shows who hasn’t chosen a password yet, and accounts outside the household', () => {
    renderCard(admin([owner, sam, stray]));
    expect(screen.getByText(/hasn’t chosen a password yet/i)).toBeInTheDocument();
    expect(screen.getByText('Other accounts on this server')).toBeInTheDocument();
  });

  it('stops offering to add people once the household is full', () => {
    const six = [owner, ...[1, 2, 3, 4, 5].map((n) => ({ ...sam, id: `2222222${n}-2222-4222-8222-222222222222`, name: `P${n}` }))];
    renderCard(admin(six));
    expect(screen.queryByRole('button', { name: /add and make an invite/i })).not.toBeInTheDocument();
    expect(screen.getByText(/household is full/i)).toBeInTheDocument();
  });
});
