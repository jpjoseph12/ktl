import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AndroidHousehold from './Household';
import { useKettle } from '../../context/KettleContext';
import { useWalkthrough } from '../../context/WalkthroughContext';

vi.mock('../../components/YourDataSection', () => ({ default: () => null }));
vi.mock('../../context/AppLockContext', () => ({ useAppLock: () => ({ on: false, lock: null, turnOn: async () => {}, changePin: async () => {}, turnOff: () => {}, setOption: () => {} }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ updatePassword: async () => {}, signOut: async () => {} }) }));
vi.mock('../../context/KettleContext', () => ({
  useKettle: vi.fn()
}));

vi.mock('../../context/WalkthroughContext', () => ({
  useWalkthrough: vi.fn()
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn().mockResolvedValue(undefined) }
}));

useWalkthrough.mockReturnValue({ targetRef: () => () => {}, restart: vi.fn() });

const YOU = { id: 'me', name: 'Alex', initials: 'A', role: 'owner' };

function membersOf(others) {
  return [YOU, ...others];
}

function baseKettle(overrides = {}) {
  const members = overrides.members || membersOf([{ id: 'sam', name: 'Sam', initials: 'S' }]);
  const you = overrides.you || YOU;
  const partner = overrides.partner !== undefined ? overrides.partner : members.find((m) => m.id !== you.id) || null;
  return {
    you,
    partner,
    members,
    data: {
      household: { id: 'h1', name: 'Our place', code: 'ABC-1234', payoutRef: null, mode: 'chase', since: 'Jan 2026', split: '50% each' },
      reminders: { detailsLead: 5, detailsTime: '09:00', paymentLead: 2, paymentTime: '18:00', nudgeAfter: 24, quietFrom: '22:00', quietTo: '08:00' }
    },
    balance: () => ({ youOwe: 0, theyOwe: 0, net: 0, inFlightToYou: 0, inFlightFromYou: 0, settled: 0 }),
    openCount: () => 0,
    mode: () => 'chase',
    setMode: vi.fn().mockResolvedValue('chase'),
    renameHousehold: vi.fn().mockResolvedValue(undefined),
    regenerateCode: vi.fn().mockResolvedValue('NEW-CODE'),
    updateReminders: vi.fn().mockResolvedValue(undefined),
    joinHousehold: vi.fn().mockResolvedValue(undefined),
    memberExitSummary: () => ({ openCount: 0, theyOweYou: 0, youOweThem: 0 }),
    removeMember: vi.fn().mockResolvedValue(undefined),
    leaveHousehold: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function renderHousehold(overrides) {
  useKettle.mockReturnValue(baseKettle(overrides));
  render(
    <MemoryRouter>
      <AndroidHousehold />
    </MemoryRouter>
  );
}

describe('AndroidHousehold — N-member roster', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('lists every member, not just a hardcoded you/partner pair', () => {
    const members = membersOf([
      { id: 'sam', name: 'Sam', initials: 'S' },
      { id: 'riley', name: 'Riley', initials: 'R' },
      { id: 'alex', name: 'Alex', initials: 'A' }
    ]);
    renderHousehold({ members });

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Riley')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText(/4 of 6/i)).toBeInTheDocument();
  });

  it('has no household code, share sheet or join box — everyone on the server is in it', () => {
    renderHousehold();

    expect(screen.queryByText(/household code/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /share the code/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/join a different household/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /leave this household/i })).not.toBeInTheDocument();
  });

  it('tells the owner where to add people when it’s just them', () => {
    renderHousehold({ members: membersOf([]) });
    expect(screen.getByText(/add the people you share with under server/i)).toBeInTheDocument();
  });
});

describe('AndroidHousehold — deleting your account (Google Play requirement)', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  const SAM = { id: 'sam', name: 'Sam', initials: 'S', role: 'member' };

  it('asks before deleting, spelling out the write-offs when leaving a shared household', async () => {
    const user = userEvent.setup();
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    renderHousehold({
      members: membersOf([SAM]),
      memberExitSummary: () => ({ openCount: 1, theyOweYou: 0, youOweThem: 25 }),
      deleteAccount
    });

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(deleteAccount).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog', { name: /delete your account\?/i });
    expect(within(dialog).getByText(/£25\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can’t be undone/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('keeps the account and says why when deletion fails', async () => {
    const user = userEvent.setup();
    const deleteAccount = vi.fn().mockRejectedValue(new Error('Your account couldn’t be deleted. Check your connection and try again.'));
    renderHousehold({ deleteAccount });

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.click(within(screen.getByRole('alertdialog', { name: /delete your account\?/i })).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/couldn’t be deleted/i)).toBeInTheDocument();
  });
});

describe('AndroidHousehold — removing someone and leaving', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  const SAM = { id: 'sam', name: 'Sam', initials: 'S', role: 'member' };

  it('offers Remove against other people, but never against yourself', () => {
    renderHousehold({ members: membersOf([SAM]) });
    // One other member, so exactly one Remove button — not two.
    expect(screen.getAllByRole('button', { name: /^remove$/i })).toHaveLength(1);
  });

  it('hides Remove entirely when you are not the owner', () => {
    const me = { ...YOU, role: 'member' };
    renderHousehold({ you: me, members: [me, { ...SAM, role: 'owner' }] });
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument();
  });

  it('spells out what gets written off before removing them', async () => {
    const user = userEvent.setup();
    renderHousehold({
      members: membersOf([SAM]),
      memberExitSummary: () => ({ openCount: 2, theyOweYou: 40, youOweThem: 0 })
    });

    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    const dialog = screen.getByRole('alertdialog', { name: /remove sam\?/i });
    expect(within(dialog).getByText(/£40\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/written off/i)).toBeInTheDocument();
  });

  it('calls removeMember with that person once confirmed', async () => {
    const user = userEvent.setup();
    const removeMember = vi.fn().mockResolvedValue(undefined);
    renderHousehold({ members: membersOf([SAM]), removeMember });

    // Only the row's button exists until the dialog opens.
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    const dialog = screen.getByRole('alertdialog', { name: /remove sam\?/i });
    await user.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    expect(removeMember).toHaveBeenCalledWith('sam');
  });

  it('says nothing changes when they have nothing outstanding', async () => {
    const user = userEvent.setup();
    renderHousehold({
      members: membersOf([SAM]),
      memberExitSummary: () => ({ openCount: 0, theyOweYou: 0, youOweThem: 0 })
    });

    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(screen.getByText(/nothing of theirs is outstanding/i)).toBeInTheDocument();
  });
});

describe('AndroidHousehold — reminders and the transfer reference', () => {
  beforeEach(() => {
    useKettle.mockReset();
  });

  it('saves the reminder switches for the household instead of just flipping them', async () => {
    const user = userEvent.setup();
    const updateReminders = vi.fn().mockResolvedValue(undefined);
    renderHousehold({ updateReminders });

    await user.click(screen.getByRole('switch', { name: 'Nudge if nobody confirms' }));
    expect(updateReminders).toHaveBeenCalledWith({ nudgeAfter: 0 });
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(updateReminders).toHaveBeenCalledWith({ quietFrom: '00:00', quietTo: '00:00' });
    await user.click(screen.getByRole('switch', { name: 'Sunday summary' }));
    expect(updateReminders).toHaveBeenCalledWith({ weeklyDigest: false });
  });

  it('lets anyone set the transfer reference, even when there isn’t one yet', async () => {
    const user = userEvent.setup();
    const setPayoutRef = vi.fn().mockResolvedValue(undefined);
    renderHousehold({ setPayoutRef });

    await user.click(screen.getByRole('button', { name: /transfer reference/i }));
    await user.type(screen.getByLabelText('Reference'), 'FLAT4 BILLS');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setPayoutRef).toHaveBeenCalledWith('FLAT4 BILLS');
  });
});
