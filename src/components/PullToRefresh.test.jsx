import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PullToRefresh from './PullToRefresh';

function touch(clientY) {
  return { touches: [{ clientY }] };
}

describe('PullToRefresh — a manual fallback alongside the live stream, not a replacement for it', () => {
  it('calls onRefresh after a drag past the threshold is released', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const main = screen.getByText('content').closest('main');

    fireEvent.touchStart(main, touch(0));
    fireEvent.touchMove(main, touch(200)); // well past the 64px threshold after resistance
    fireEvent.touchEnd(main);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not call onRefresh when released before the threshold', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const main = screen.getByText('content').closest('main');

    fireEvent.touchStart(main, touch(0));
    fireEvent.touchMove(main, touch(20)); // 10px resisted — short of 64
    fireEvent.touchEnd(main);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores the gesture entirely when the list is already scrolled down', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const main = screen.getByText('content').closest('main');
    Object.defineProperty(main, 'scrollTop', { value: 40, configurable: true });

    fireEvent.touchStart(main, touch(0));
    fireEvent.touchMove(main, touch(300));
    fireEvent.touchEnd(main);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a touch cancel resets the drag without calling onRefresh', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    const main = screen.getByText('content').closest('main');

    fireEvent.touchStart(main, touch(0));
    fireEvent.touchMove(main, touch(200));
    fireEvent.touchCancel(main);
    fireEvent.touchEnd(main);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('renders without a crash when onRefresh is not provided', () => {
    render(<PullToRefresh><p>content</p></PullToRefresh>);
    const main = screen.getByText('content').closest('main');

    fireEvent.touchStart(main, touch(0));
    fireEvent.touchMove(main, touch(200));
    expect(() => fireEvent.touchEnd(main)).not.toThrow();
  });
});
