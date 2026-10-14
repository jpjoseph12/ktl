import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Welcome from './Welcome';
import { useKettle } from '../context/KettleContext';
import { usePrivate } from '../context/PrivateContext';
import { useWalkthrough } from '../context/WalkthroughContext';

vi.mock('../context/KettleContext', () => ({ useKettle: vi.fn() }));
vi.mock('../context/PrivateContext', () => ({ usePrivate: vi.fn() }));
vi.mock('../context/WalkthroughContext', () => ({ useWalkthrough: vi.fn() }));
vi.mock('../context/AppLockContext', () => ({ useAppLock: () => ({ on: false, turnOn: vi.fn() }) }));
vi.mock('../lib/notifications', () => ({ permissionState: vi.fn().mockResolvedValue('prompt'), requestPermission: vi.fn().mockResolvedValue('granted') }));

let K;
let M;
let W;

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/android/home" element={<p>Home screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Welcome — the first time someone opens KTL', () => {
  beforeEach(() => {
    K = {
      you: { id: 'u2', name: 'New user', firstRunDone: false },
      members: [
        { id: 'u1', name: 'Alex Rivera', initials: 'AR', role: 'owner' },
        { id: 'u2', name: 'New user', initials: 'NU', role: 'member' }
      ],
      data: { household: { id: 'h1', name: 'Flat 4' }, bills: [{ id: 'b1' }] },
      updateMyName: vi.fn().mockResolvedValue(),
      finishFirstRun: vi.fn().mockResolvedValue()
    };
    M = { state: { income: 0, payday: '', debtModule: false }, setMany: vi.fn().mockResolvedValue(), set: vi.fn().mockResolvedValue() };
    W = { skip: vi.fn(), restart: vi.fn() };
    useKettle.mockReturnValue(K);
    usePrivate.mockReturnValue(M);
    useWalkthrough.mockReturnValue(W);
  });

  it('welcomes them to the household, shows who’s here and asks their name', async () => {
    const user = userEvent.setup();
    renderWelcome();
    expect(screen.getByRole('heading', { name: 'Welcome to Flat 4' })).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('');

    await user.type(screen.getByLabelText('Your name'), 'Sam Okafor');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(K.updateMyName).toHaveBeenCalledWith('Sam Okafor');
    expect(await screen.findByRole('heading', { name: 'Your private space' })).toBeInTheDocument();
  });

  it('saves their own pay and debt planner privately, or lets them skip it', async () => {
    const user = userEvent.setup();
    K.you.name = 'Sam';
    renderWelcome();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/Only you can see this/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Take-home pay each month'), '2150');
    await user.type(screen.getByLabelText('Payday'), '28th');
    await user.click(screen.getByRole('switch', { name: 'Debt planner' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(M.setMany).toHaveBeenCalledWith({ income: 2150, payday: '28th' });
    expect(M.set).toHaveBeenCalledWith('debtModule', true);
    expect(await screen.findByRole('heading', { name: /This (phone|device)/ })).toBeInTheDocument();
  });

  it('offers the app lock, then finishes into the tour — once', async () => {
    const user = userEvent.setup();
    K.you.name = 'Sam';
    renderWelcome();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('button', { name: 'Set a PIN' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/bills are already here/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show me around' }));
    expect(K.finishFirstRun).toHaveBeenCalled();
    expect(W.skip).toHaveBeenCalled();
    expect(await screen.findByText('Home screen')).toBeInTheDocument();
  });

  it('points whoever runs the server to the admin screens', () => {
    K.you = { id: 'u1', name: 'Alex Rivera', firstRunDone: false };
    renderWelcome();
    expect(screen.getByText(/Your server is set up/)).toBeInTheDocument();
  });
});
