import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ SERVER_URL: 'https://ktl.test', api: {} }));

const { parseEvents } = await import('./live');

describe('parseEvents', () => {
  it('reads complete events and keeps a partial one for the next chunk', () => {
    const chunk = 'data: {"id":"a1","text":"Added Rent"}\n\n: keep-alive\n\ndata: {"id":"a2"';
    const { events, rest } = parseEvents(chunk);
    expect(events).toEqual([{ id: 'a1', text: 'Added Rent' }]);
    expect(rest).toBe('data: {"id":"a2"');
  });

  it('skips anything that is not JSON instead of throwing', () => {
    expect(parseEvents('data: not json\n\n').events).toEqual([]);
  });
});
