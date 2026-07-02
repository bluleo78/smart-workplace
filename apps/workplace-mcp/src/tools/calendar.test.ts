import { describe, expect, it, vi } from 'vitest';
import { mockPatApiClient as mockClient } from './test-support.js';
import { buildCalendarTools } from './calendar.js';

describe('buildCalendarTools', () => {
  it('list_events → client.listEvents(from, to)', async () => {
    const c = mockClient();
    (c.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 1, title: '회의' }]);
    const t = buildCalendarTools(c).find((x) => x.name === 'list_events')!;
    const out = await t.handler({ from: '2026-07-01', to: '2026-07-31' });
    expect(c.listEvents).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
    expect(JSON.parse(out)).toEqual([{ id: 1, title: '회의' }]);
  });

  it('list_events 는 from/to 누락 시 zod 파싱을 거부한다', async () => {
    const c = mockClient();
    const t = buildCalendarTools(c).find((x) => x.name === 'list_events')!;
    await expect(t.handler({ from: '2026-07-01' })).rejects.toThrow();
    expect(c.listEvents).not.toHaveBeenCalled();
  });

  it('get_event → client.getEvent(eventId)', async () => {
    const c = mockClient();
    (c.getEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, title: '회의' });
    const t = buildCalendarTools(c).find((x) => x.name === 'get_event')!;
    const out = await t.handler({ eventId: 1 });
    expect(c.getEvent).toHaveBeenCalledWith(1);
    expect(JSON.parse(out)).toEqual({ id: 1, title: '회의' });
  });
});
