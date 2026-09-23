import { describe, expect, it, vi } from 'vitest';
import { buildCalendarTools, normalizeTimezone } from './calendar-tools.js';
import type { CalendarToolClient } from './tool-client.js';

/** 캘린더 클라이언트 mock. */
function mockClient(): CalendarToolClient {
  return {
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({}),
  };
}

const tool = (c: CalendarToolClient, name: string) => buildCalendarTools(c).find((x) => x.name === name)!;

describe('normalizeTimezone (#394)', () => {
  it('오프셋 없는 naive datetime 에 +09:00 을 붙인다', () => {
    expect(normalizeTimezone('2026-06-20T14:00:00')).toBe('2026-06-20T14:00:00+09:00');
    expect(normalizeTimezone('2026-06-20T14:00')).toBe('2026-06-20T14:00+09:00');
  });

  it('Z(UTC) 로 끝나면 그대로 둔다(대소문자 무관)', () => {
    expect(normalizeTimezone('2026-06-20T05:00:00Z')).toBe('2026-06-20T05:00:00Z');
    expect(normalizeTimezone('2026-06-20T05:00:00z')).toBe('2026-06-20T05:00:00z');
  });

  it('±HH:MM 오프셋이 이미 있으면 그대로 둔다', () => {
    expect(normalizeTimezone('2026-06-20T14:00:00+09:00')).toBe('2026-06-20T14:00:00+09:00');
    expect(normalizeTimezone('2026-06-20T14:00:00-05:00')).toBe('2026-06-20T14:00:00-05:00');
  });
});

describe('buildCalendarTools', () => {
  it('list_events → 오프셋 있는 from/to 는 그대로 client.listEvents 에 전달', async () => {
    const c = mockClient();
    vi.mocked(c.listEvents).mockResolvedValue([{ id: 1, title: '회의', startsAt: '2026-06-20T10:00:00Z', endsAt: '2026-06-20T11:00:00Z' }]);
    const out = await tool(c, 'list_events').handler({ from: '2026-06-19T00:00:00Z', to: '2026-06-26T00:00:00Z' });
    expect(c.listEvents).toHaveBeenCalledWith('2026-06-19T00:00:00Z', '2026-06-26T00:00:00Z');
    expect(JSON.parse(out)).toEqual([{ id: 1, title: '회의', startsAt: '2026-06-20T10:00:00Z', endsAt: '2026-06-20T11:00:00Z' }]);
  });

  it('list_events → naive datetime 은 +09:00 을 보정해 전달한다', async () => {
    const c = mockClient();
    await tool(c, 'list_events').handler({ from: '2026-06-19T00:00:00', to: '2026-06-26T00:00:00+09:00' });
    expect(c.listEvents).toHaveBeenCalledWith('2026-06-19T00:00:00+09:00', '2026-06-26T00:00:00+09:00');
  });

  it('list_events 는 from/to 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    await expect(tool(c, 'list_events').handler({ from: '2026-07-01T00:00:00Z' })).rejects.toThrow();
    expect(c.listEvents).not.toHaveBeenCalled();
  });

  it('get_event → client.getEvent(eventId)', async () => {
    const c = mockClient();
    vi.mocked(c.getEvent).mockResolvedValue({ id: 1, title: '회의' });
    const out = await tool(c, 'get_event').handler({ eventId: 1 });
    expect(c.getEvent).toHaveBeenCalledWith(1);
    expect(JSON.parse(out)).toEqual({ id: 1, title: '회의' });
  });

  it('get_event 는 옛 파라미터 id 를 거부한다(eventId 만)', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_event').handler({ id: 1 })).rejects.toThrow();
    expect(c.getEvent).not.toHaveBeenCalled();
  });
});
