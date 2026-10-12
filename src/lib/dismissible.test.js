import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDismissibleNotice } from './dismissible';

describe('useDismissibleNotice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts out not dismissed', () => {
    const { result } = renderHook(() => useDismissibleNotice('test-key', 'a,b'));
    expect(result.current.dismissed).toBe(false);
  });

  it('becomes dismissed after calling dismiss, and persists across remounts', () => {
    const { result, unmount } = renderHook(() => useDismissibleNotice('test-key', 'a,b'));
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);

    unmount();
    const { result: result2 } = renderHook(() => useDismissibleNotice('test-key', 'a,b'));
    expect(result2.current.dismissed).toBe(true);
  });

  it('reappears once the signature changes', () => {
    const { result, rerender } = renderHook(({ sig }) => useDismissibleNotice('test-key', sig), {
      initialProps: { sig: 'a,b' }
    });
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);

    rerender({ sig: 'a,b,c' });
    expect(result.current.dismissed).toBe(false);
  });

  it('never reports dismissed when the signature is empty', () => {
    const { result } = renderHook(() => useDismissibleNotice('test-key', ''));
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(false);
  });
});
