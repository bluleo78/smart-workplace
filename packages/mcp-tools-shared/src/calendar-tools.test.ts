import { describe, expect, it, vi } from 'vitest';
import {
  buildCalendarTools,
  createEventInput,
  listConflicts,
  normalizeTimezone,
  resolveAttendees,
  resolveAttendeeToRemove,
  type CalendarToolsClient,
  updateEventInput,
} from './calendar-tools.js';
import type { MemberRow } from './tool-client.js';
import { resultText } from './mcp-content.js';

/** 구성원 디렉터리 — searchMembers 목이 username 정확일치 행을 돌려준다. 1 은 호출자(주최자). */
const MEMBERS: MemberRow[] = [
  { userId: 1, username: 'me', name: '나', active: true },
  { userId: 2, username: 'alice', name: '앨리스', active: true },
  { userId: 3, username: 'bob', name: '밥', active: true },
  { userId: 4, username: 'gone', name: '퇴사자', active: false },
];

/** 캘린더 클라이언트 mock(참석자 해석용 searchMembers·호출자 getMe 포함). */
function mockClient(): CalendarToolsClient {
  return {
    listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue({}),
    rsvpEvent: vi.fn().mockResolvedValue(undefined),
    createEvent: vi.fn().mockResolvedValue({ id: 100, title: '회의' }),
    updateEvent: vi.fn().mockResolvedValue({ id: 7 }),
    addEventAttendees: vi.fn().mockResolvedValue(undefined),
    removeEventAttendee: vi.fn().mockResolvedValue(undefined),
    searchMembers: vi.fn(async ({ search }) => MEMBERS.filter((m) => m.username.includes(search ?? ''))),
    getMe: vi.fn().mockResolvedValue({ id: 1, username: 'me' }),
  };
}

const tool = (c: CalendarToolsClient, name: string) => buildCalendarTools(c).find((x) => x.name === name)!;

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
    expect(JSON.parse(resultText(out))).toEqual([{ id: 1, title: '회의', startsAt: '2026-06-20T10:00:00Z', endsAt: '2026-06-20T11:00:00Z' }]);
  });

  it('list_events → 300자를 넘는 설명은 잘라 …를 붙이고, null·짧은 설명은 그대로 둔다', async () => {
    const c = mockClient();
    const base = { startsAt: '2026-06-20T10:00:00Z', endsAt: '2026-06-20T11:00:00Z' };
    vi.mocked(c.listEvents).mockResolvedValue([
      { id: 1, title: '긴', ...base, description: 'x'.repeat(10_000) },
      { id: 2, title: '짧은', ...base, description: 'y'.repeat(300) },
      { id: 3, title: '없음', ...base, description: null },
      { id: 4, title: '필드없음', ...base },
      { id: 5, title: '이모지', ...base, description: 'a'.repeat(299) + '😀' + 'b'.repeat(50) },
    ]);
    const out = JSON.parse(resultText(await tool(c, 'list_events').handler({ from: '2026-06-19T00:00:00Z', to: '2026-06-26T00:00:00Z' })));
    expect(out[0].description).toBe('x'.repeat(300) + '…');
    expect(out[1].description).toBe('y'.repeat(300));
    expect(out[2].description).toBeNull();
    expect('description' in out[3]).toBe(false);
    expect(out[4].description).toBe('a'.repeat(299) + '…'); // 쌍을 가르지 않고 앞에서 자른다
  });

  it('list_events 설명이 get_event 로 전문을 얻는다고 안내한다', () => {
    expect(tool(mockClient(), 'list_events').description).toContain('get_event');
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
    expect(JSON.parse(resultText(out))).toEqual({ id: 1, title: '회의' });
  });

  it('get_event 는 색·캘린더 id·생성 시각·iCalUid·참석자 총원과 값이 없는 키를 뺀다(WP-353)', async () => {
    const c = mockClient();
    const raw = {
      id: 7, title: '회의', description: null, startsAt: '2026-10-20T10:00:00+09:00', endsAt: '2026-10-20T11:00:00+09:00', allDay: false, location: null,
      color: null, calendarId: 1, calendarName: '내 캘린더', effectiveColor: 'blue', reminderMinutes: null, recurrenceRule: null, masterEventId: null, occurrenceDate: null,
      createdAt: '2026-10-01T00:00:00+09:00', updatedAt: '2026-10-02T00:00:00+09:00', attendeeCount: 1, myRsvpStatus: 'ACCEPTED',
      attendees: [{ userId: 1, username: 'me', name: '나', kind: 'HUMAN', role: 'ORGANIZER', rsvpStatus: 'ACCEPTED', invitedByUserId: 1, externalEmail: null }],
      external: false, myRole: 'ORGANIZER', iCalUid: null,
    };
    vi.mocked(c.getEvent).mockResolvedValue(raw);
    const out = JSON.parse(resultText(await tool(c, 'get_event').handler({ eventId: 7 })));
    expect(out).toEqual({
      id: 7, title: '회의', startsAt: '2026-10-20T10:00:00+09:00', endsAt: '2026-10-20T11:00:00+09:00', allDay: false, calendarName: '내 캘린더',
      updatedAt: '2026-10-02T00:00:00+09:00', myRsvpStatus: 'ACCEPTED', attendees: [{ username: 'me', name: '나', kind: 'HUMAN', role: 'ORGANIZER', rsvpStatus: 'ACCEPTED' }],
      external: false, myRole: 'ORGANIZER',
    });
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(raw).length * 0.75);
  });

  it('get_event 는 반복 일정 수정에 쓰는 masterEventId·occurrenceDate 를 남긴다', async () => {
    const c = mockClient();
    vi.mocked(c.getEvent).mockResolvedValue({ id: 7, title: 'x', masterEventId: 3, occurrenceDate: '2026-10-20T01:00:00Z', recurrenceRule: 'FREQ=WEEKLY', attendees: [] });
    const out = JSON.parse(resultText(await tool(c, 'get_event').handler({ eventId: 7 })));
    expect(out).toMatchObject({ masterEventId: 3, occurrenceDate: '2026-10-20T01:00:00Z', recurrenceRule: 'FREQ=WEEKLY' });
  });

  it('get_event 는 옛 파라미터 id 를 거부한다(eventId 만)', async () => {
    const c = mockClient();
    await expect(tool(c, 'get_event').handler({ id: 1 })).rejects.toThrow();
    expect(c.getEvent).not.toHaveBeenCalled();
  });
});

describe('rsvp_event (#855)', () => {
  it('status 를 그대로 client.rsvpEvent 에 넘긴다', async () => {
    const c = mockClient();
    expect(await tool(c, 'rsvp_event').handler({ eventId: 7, status: 'DECLINED' })).toBe('ok');
    expect(c.rsvpEvent).toHaveBeenCalledWith(7, 'DECLINED');
  });

  it('status 는 필수 — 서버는 null 을 통과시키므로 도구가 막는다', async () => {
    const c = mockClient();
    await expect(tool(c, 'rsvp_event').handler({ eventId: 7 })).rejects.toThrow();
    await expect(tool(c, 'rsvp_event').handler({ eventId: 7, status: 'NEEDS_ACTION' })).rejects.toThrow();
    expect(c.rsvpEvent).not.toHaveBeenCalled();
  });
});

describe('공유 일정 헬퍼 (WP-348)', () => {
  it('resolveAttendees: username → id, 주최자는 빼고 "이름(username)" 라벨을 준다', async () => {
    const c = mockClient();
    expect(await resolveAttendees(c, ['alice', 'me', 'alice', 'bob'], 1)).toEqual({
      ids: [2, 3],
      names: ['앨리스(alice)', '밥(bob)'],
    });
  });

  it('resolveAttendees: 주최자뿐이면 ids 가 없다', async () => {
    expect(await resolveAttendees(mockClient(), ['me'], 1)).toEqual({ ids: undefined, names: [] });
    expect(await resolveAttendees(mockClient(), undefined, 1)).toEqual({ ids: undefined, names: [] });
  });

  it('resolveAttendees: 없는 이름·비활성 계정을 한 번에 모아 알린다', async () => {
    const r = await resolveAttendees(mockClient(), ['nobody', 'gone', 'alice'], 1);
    expect(r).toEqual({
      error:
        '오류: 참석자를 확정하지 못했습니다(찾을 수 없는 username: nobody / 비활성 계정: gone). search_members 로 정확한 username 을 확인하세요. 외부 이메일 참석자는 지원하지 않습니다.',
    });
  });

  it('resolveAttendeeToRemove: 비활성 계정도 뺄 수 있고, 없는 이름·주최자 본인은 오류', async () => {
    const c = mockClient();
    expect(await resolveAttendeeToRemove(c, 'gone', 1)).toEqual({ member: MEMBERS[3] });
    expect(await resolveAttendeeToRemove(c, 'nobody', 1)).toEqual({
      error: "오류: username='nobody' 인 구성원을 찾을 수 없습니다. search_members 로 대상을 다시 찾아 정확한 username 을 확인하세요.",
    });
    expect(await resolveAttendeeToRemove(c, 'me', 1)).toEqual({ error: '오류: 주최자 본인은 참석자에서 제거할 수 없습니다.' });
  });

  it('listConflicts: listEvents 결과를 id·title·startsAt·endsAt 로 줄인다', async () => {
    const c = mockClient();
    vi.mocked(c.listEvents).mockResolvedValue([
      { id: 5, title: '기존', startsAt: 'a', endsAt: 'b', location: '회의실', attendeeCount: 3 },
    ]);
    expect(await listConflicts(c, 'f', 't')).toEqual([{ id: 5, title: '기존', startsAt: 'a', endsAt: 'b' }]);
    expect(c.listEvents).toHaveBeenCalledWith('f', 't');
  });
});

describe('create_event (WP-348)', () => {
  const base = { title: '회의', startsAt: '2026-06-20T14:00:00', endsAt: '2026-06-20T15:00:00' };

  it('시간대를 보정하고 참석자를 id 로 해석해 notify 와 함께 만든다', async () => {
    const c = mockClient();
    const out = await tool(c, 'create_event').handler({ ...base, attendees: ['alice', 'me'], notify: false, location: '3층' });
    expect(c.createEvent).toHaveBeenCalledWith(
      {
        title: '회의',
        startsAt: '2026-06-20T14:00:00+09:00',
        endsAt: '2026-06-20T15:00:00+09:00',
        allDay: false,
        location: '3층',
        attendeeUserIds: [2],
      },
      { notify: false },
    );
    expect(JSON.parse(resultText(out))).toEqual({ event: { id: 100, title: '회의' } });
  });

  it('notify 기본값은 true, 참석자가 없으면 호출자 조회도 하지 않는다', async () => {
    const c = mockClient();
    await tool(c, 'create_event').handler(base);
    expect(c.createEvent).toHaveBeenCalledWith(expect.objectContaining({ attendeeUserIds: undefined }), { notify: true });
    expect(c.getMe).not.toHaveBeenCalled();
  });

  it('만들기 전에 보정된 시간대로 충돌을 조회해 결과에 싣는다', async () => {
    const c = mockClient();
    vi.mocked(c.listEvents).mockResolvedValue([{ id: 5, title: '기존', startsAt: 'a', endsAt: 'b' }]);
    const out = await tool(c, 'create_event').handler(base);
    expect(c.listEvents).toHaveBeenCalledWith('2026-06-20T14:00:00+09:00', '2026-06-20T15:00:00+09:00');
    expect(vi.mocked(c.listEvents).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(c.createEvent).mock.invocationCallOrder[0]);
    expect(JSON.parse(resultText(out)).conflicts).toEqual([{ id: 5, title: '기존', startsAt: 'a', endsAt: 'b' }]);
  });

  it('충돌 조회 실패는 생성을 막지 않는다(fail-open)', async () => {
    const c = mockClient();
    vi.mocked(c.listEvents).mockRejectedValue(new Error('down'));
    const out = await tool(c, 'create_event').handler(base);
    expect(c.createEvent).toHaveBeenCalled();
    expect(JSON.parse(resultText(out))).toEqual({ event: { id: 100, title: '회의' } });
  });

  it('참석자를 확정하지 못하면 만들지 않고 사유를 던진다', async () => {
    const c = mockClient();
    await expect(tool(c, 'create_event').handler({ ...base, attendees: ['nobody'] })).rejects.toThrow(/찾을 수 없는 username: nobody/);
    expect(c.createEvent).not.toHaveBeenCalled();
  });
});

describe('update_event (WP-348)', () => {
  const current = {
    id: 7,
    title: '주간 회의',
    description: '안건',
    startsAt: '2026-06-20T05:00:00Z',
    endsAt: '2026-06-20T06:00:00Z',
    allDay: false,
    location: '3층',
    color: 'red',
    reminderMinutes: 10,
    recurrenceRule: null,
    attendees: [
      { userId: 1, username: 'me' },
      { userId: 2, username: 'alice' },
      { userId: null, username: null, externalEmail: 'x@ext.com' },
    ],
  };
  const withCurrent = (over: Record<string, unknown> = {}) => {
    const c = mockClient();
    vi.mocked(c.getEvent).mockResolvedValue({ ...current, ...over });
    return c;
  };

  it('준 필드만 바꾸고 나머지는 현재 값으로 채워 전체 교체 PATCH 를 보낸다', async () => {
    const c = withCurrent();
    const out = await tool(c, 'update_event').handler({ eventId: 7, title: '새 제목', startsAt: '2026-06-20T15:00:00', endsAt: '2026-06-20T16:00:00' });
    expect(c.updateEvent).toHaveBeenCalledWith(
      7,
      {
        title: '새 제목',
        description: '안건',
        startsAt: '2026-06-20T15:00:00+09:00',
        endsAt: '2026-06-20T16:00:00+09:00',
        allDay: false,
        location: '3층',
        color: 'red',
        reminderMinutes: 10,
        recurrenceRule: null,
      },
      { scope: 'ALL', occurrenceDate: undefined },
    );
    expect(JSON.parse(resultText(out))).toEqual({ ok: true, results: { fields: 'ok' } });
  });

  it('null 은 비울 수 있는 필드를 비우고, title·시각의 null 은 현재 값 유지로 본다', async () => {
    const c = withCurrent();
    await tool(c, 'update_event').handler({ eventId: 7, title: null, startsAt: null, location: null, reminderMinutes: null });
    expect(c.updateEvent).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: '주간 회의', startsAt: current.startsAt, location: null, reminderMinutes: null, description: '안건' }),
      expect.anything(),
    );
  });

  it('반복 일정의 THIS 수정은 회차 시각이 없으면 거절하고, 있으면 scope·보정된 occurrenceDate 로 보낸다', async () => {
    const c = withCurrent({ recurrenceRule: 'FREQ=WEEKLY' });
    await expect(
      tool(c, 'update_event').handler({ eventId: 7, scope: 'THIS', occurrenceDate: '2026-06-27T14:00:00', title: '이번만' }),
    ).rejects.toThrow(/startsAt 과 endsAt/);
    expect(c.updateEvent).not.toHaveBeenCalled();

    await tool(c, 'update_event').handler({
      eventId: 7, scope: 'THIS', occurrenceDate: '2026-06-27T14:00:00', title: '이번만',
      startsAt: '2026-06-27T15:00:00+09:00', endsAt: '2026-06-27T16:00:00+09:00',
    });
    expect(c.updateEvent).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: '이번만', recurrenceRule: 'FREQ=WEEKLY' }),
      { scope: 'THIS', occurrenceDate: '2026-06-27T14:00:00+09:00' },
    );
  });

  it('참석자만 바꾸면 PATCH 없이 추가(notify)·제거만 한다', async () => {
    const c = withCurrent();
    const out = await tool(c, 'update_event').handler({ eventId: 7, addAttendees: ['bob'], removeAttendees: ['alice'], notify: false });
    expect(c.updateEvent).not.toHaveBeenCalled();
    expect(c.addEventAttendees).toHaveBeenCalledWith(7, [3], { notify: false });
    expect(c.removeEventAttendee).toHaveBeenCalledWith(7, 2);
    expect(JSON.parse(resultText(out))).toEqual({ ok: true, results: { addAttendees: 'ok', 'removeAttendee:alice': 'ok' } });
  });

  it('바꿀 내용이 없으면 조회도 하지 않고 거절한다', async () => {
    const c = withCurrent();
    await expect(tool(c, 'update_event').handler({ eventId: 7, title: null, addAttendees: [] })).rejects.toThrow(/바꿀 내용이 없습니다/);
    expect(c.getEvent).not.toHaveBeenCalled();
  });

  it('카드 사전검증과 같은 참석자 판정 — 이미 참석자·주최자뿐·참석자 아님·주최자 제거는 쓰기 전에 거절한다', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ addAttendees: ['alice'] }, /이미 이 일정의 참석자입니다: alice/],
      [{ addAttendees: ['me'] }, /초대할 참석자가 없습니다/],
      [{ addAttendees: ['gone'] }, /비활성 계정: gone/],
      [{ removeAttendees: ['bob'] }, /이 일정의 참석자가 아닙니다: bob/],
      [{ removeAttendees: ['me'] }, /주최자 본인은 참석자에서 제거할 수 없습니다/],
      [{ removeAttendees: ['nobody'] }, /username='nobody'/],
      [{ addAttendees: ['bob'], removeAttendees: ['bob'] }, /추가하면서 제거할 수 없습니다: bob/],
    ];
    for (const [input, err] of cases) {
      const c = withCurrent();
      await expect(tool(c, 'update_event').handler({ eventId: 7, title: '바꿈', ...input }), JSON.stringify(input)).rejects.toThrow(err);
      expect(c.updateEvent).not.toHaveBeenCalled();
      expect(c.addEventAttendees).not.toHaveBeenCalled();
      expect(c.removeEventAttendee).not.toHaveBeenCalled();
    }
  });

  it('필드 수정이 실패하면 참석자 추가·제거를 하지 않고 skipped 로 보고한다(초대 알림은 되돌릴 수 없다)', async () => {
    const c = withCurrent();
    vi.mocked(c.updateEvent).mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: { message: 'endsAt must be after startsAt' } } }));
    const out = JSON.parse(
      resultText(await tool(c, 'update_event').handler({ eventId: 7, title: '바꿈', addAttendees: ['bob'], removeAttendees: ['alice'] })),
    );
    expect(out.ok).toBe(false);
    expect(out.results.fields).toMatch(/^failed: /);
    expect(out.results.addAttendees).toBe('skipped: fields failed');
    expect(out.results['removeAttendee:alice']).toBe('skipped: fields failed');
    expect(c.addEventAttendees).not.toHaveBeenCalled();
    expect(c.removeEventAttendee).not.toHaveBeenCalled();
  });

  it('참석자 단계 하나가 실패해도 나머지 참석자 단계는 진행하고 단계별 결과를 보고한다', async () => {
    const c = withCurrent();
    vi.mocked(c.addEventAttendees).mockRejectedValue(new Error('down'));
    const out = JSON.parse(
      resultText(await tool(c, 'update_event').handler({ eventId: 7, title: '바꿈', addAttendees: ['bob'], removeAttendees: ['alice'] })),
    );
    expect(out).toEqual({ ok: false, results: { fields: 'ok', addAttendees: 'failed: down', 'removeAttendee:alice': 'ok' } });
  });

  it('필드를 바꿀 때 참석자 id 를 PATCH 에 싣지 않는다(서버가 거절)', async () => {
    const c = withCurrent();
    await tool(c, 'update_event').handler({ eventId: 7, location: '4층' });
    expect(vi.mocked(c.updateEvent).mock.calls[0][1]).not.toHaveProperty('attendeeUserIds');
  });
});

// WP-543: 설명은 API 상한(10000자)과 같게 도구 입력에서 먼저 막는다.
describe('일정 설명 길이 상한', () => {
  it('create_event·update_event 모두 10000자까지 허용, 넘으면 거절', () => {
    const base = { title: '회의', startsAt: '2026-11-20T10:00:00+09:00', endsAt: '2026-11-20T11:00:00+09:00' };
    expect(createEventInput.safeParse({ ...base, description: '가'.repeat(10000) }).success).toBe(true);
    expect(createEventInput.safeParse({ ...base, description: '가'.repeat(10001) }).success).toBe(false);
    expect(updateEventInput.safeParse({ eventId: 1, description: '가'.repeat(10001) }).success).toBe(false);
  });
});
