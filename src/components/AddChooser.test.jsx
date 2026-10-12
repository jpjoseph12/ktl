import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AddChooser, { ADD_CHOOSER_ID } from './AddChooser';
import { ScreenProvider, useScreen } from '../context/ScreenContext';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function Harness() {
  const { open } = useScreen();
  return (
    <>
      <button onClick={() => open(ADD_CHOOSER_ID)}>Add a cost</button>
      <AddChooser />
      <LocationProbe />
    </>
  );
}

function renderChooser(initialPath = '/android/home') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ScreenProvider>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </ScreenProvider>
    </MemoryRouter>
  );
}

async function openChooser(user) {
  await user.click(screen.getByRole('button', { name: /add a cost/i }));
}

describe('AddChooser — one entry point for every kind of cost', () => {
  it('offers shared and private options together', async () => {
    const user = userEvent.setup();
    renderChooser();
    await openChooser(user);

    expect(screen.getByRole('button', { name: /recurring cost/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /money lent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /personal bill/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /card or loan/i })).toBeInTheDocument();
  });

  it('does not navigate anywhere just from opening the chooser', async () => {
    const user = userEvent.setup();
    renderChooser('/android/home');
    await openChooser(user);

    // The old FAB jumped straight to Bills; opening the chooser must not move you.
    expect(screen.getByTestId('loc')).toHaveTextContent('/android/home');
  });

  it.each([
    [/recurring cost/i, '/android/bills?add=bill'],
    [/money lent/i, '/android/bills?add=lending'],
    [/personal bill/i, '/android/yours?add=personal'],
    [/card or loan/i, '/android/yours?add=debt']
  ])('routes %s to the screen that owns that form', async (label, expected) => {
    const user = userEvent.setup();
    renderChooser('/android/home');
    await openChooser(user);

    await user.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('loc')).toHaveTextContent(expected);
  });
});
