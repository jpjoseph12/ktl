import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoadingScreen from './LoadingScreen';

function tick(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/* The label appears twice on purpose — once in the live region for assistive
   tech, once as aria-hidden visible copy — so "is it painted?" has to ask the
   visible half specifically. */
const visible = (container) => ({
  wordmark: container.querySelector('.splash-wordmark'),
  label: container.querySelector('.boot-label'),
  dots: container.querySelector('.boot-dots'),
  slow: container.querySelector('.boot-slow'),
});

describe('LoadingScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('paints nothing for a load that settles inside the delay', () => {
    const { container } = render(<LoadingScreen label="Loading your household" />);

    tick(240);
    const v = visible(container);
    expect(v.wordmark).toBeNull();
    expect(v.label).toBeNull();
    expect(v.dots).toBeNull();
  });

  it('announces what is loading from the first frame, before anything is painted', () => {
    const { container } = render(<LoadingScreen label="Signing you in" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Signing you in');
    expect(visible(container).wordmark).toBeNull();
  });

  it('is the only live region on the screen', () => {
    render(<LoadingScreen label="Signing you in" />);
    tick(250);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('paints the mark and the label once the load outlasts the delay', () => {
    const { container } = render(<LoadingScreen label="Loading your figures" />);

    tick(250);
    const v = visible(container);
    expect(v.wordmark).toHaveTextContent('KTL');
    expect(v.label).toHaveTextContent('Loading your figures');
    expect(v.dots).toBeVisible();
  });

  it('renders into the same phone frame the real screens use', () => {
    const { container } = render(<LoadingScreen label="Loading" />);
    expect(container.querySelector('.screen > .phone-ui.android > .boot')).not.toBeNull();
  });

  it('adds the slow note only once the wait gets long', () => {
    const note = 'Still going. A slow connection can take a moment.';
    const { container } = render(<LoadingScreen label="Loading your household" />);

    tick(250);
    expect(visible(container).slow).toBeNull();

    tick(5750);
    expect(visible(container).slow).toHaveTextContent(note);
    /* The label stays put — the note explains the wait, it doesn't replace
       the answer to "waiting on what?". */
    expect(visible(container).label).toHaveTextContent('Loading your household');
    expect(screen.getByRole('status')).toHaveTextContent(
      `Loading your household. ${note}`,
    );
  });

  it('honours a custom slow note and custom timings', () => {
    const { container } = render(
      <LoadingScreen
        label="Loading"
        slowNote="Your bank is being slow."
        delay={0}
        slowAfter={1000}
      />,
    );

    expect(visible(container).wordmark).toHaveTextContent('KTL');
    expect(visible(container).slow).toBeNull();

    tick(1000);
    expect(visible(container).slow).toHaveTextContent('Your bank is being slow.');
  });

  it('drops its timers on unmount', () => {
    const { unmount } = render(<LoadingScreen label="Signing you in" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
