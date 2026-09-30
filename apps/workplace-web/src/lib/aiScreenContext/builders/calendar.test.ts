import { describe, expect, it } from 'vitest';

import { buildCalendarContext } from './calendar';

const range = { from: '2026-09-27T15:00:00.000Z', to: '2026-10-04T15:00:00.000Z' };

describe('buildCalendarContext', () => {
  it('보기·기간(KST)·일정 수', () => {
    expect(buildCalendarContext({ view: 'week', ...range, count: 5, editing: null, creating: false })).toEqual({
      view: '캘린더',
      scope: {
        label: '주 보기',
        refs: { from: range.from, to: range.to },
        facts: [{ label: '기간', value: '2026-09-28 ~ 2026-10-04' }],
        count: 5,
      },
    });
  });

  it('일정 조회 전(count 미지정)에는 scope.count 를 싣지 않는다', () => {
    const ctx = buildCalendarContext({ view: 'week', ...range, editing: null, creating: false });
    expect(ctx.scope).not.toHaveProperty('count');
  });

  it('반복 회차 — masterEventId 를 eventId 로, 회차 일시·회차일 포함', () => {
    const ctx = buildCalendarContext({
      view: 'month', ...range, count: 1, creating: false,
      editing: { id: 7, masterEventId: 3, title: '주간회의', startsAt: '2026-10-01T01:00:00Z', endsAt: '2026-10-01T02:00:00Z', allDay: false, location: '3층', calendarName: '팀', myRsvpStatus: 'ACCEPTED', occurrenceDate: '2026-10-01' },
    });
    expect(ctx.focus).toEqual({
      type: '일정',
      label: '주간회의',
      refs: { eventId: '3' },
      facts: [
        { label: '일시', value: '2026-10-01 10:00 ~ 2026-10-01 11:00' },
        { label: '반복 회차일', value: '2026-10-01' },
        { label: '장소', value: '3층' },
        { label: '캘린더', value: '팀' },
        { label: '내 응답', value: 'ACCEPTED' },
      ],
    });
  });

  it('새 일정 작성 중', () => {
    expect(buildCalendarContext({ view: 'day', ...range, count: 0, editing: null, creating: true }).focus).toEqual({ type: '일정', label: '새 일정 작성 중', refs: {} });
  });

  it('종일 일정은 날짜만', () => {
    const ctx = buildCalendarContext({
      view: 'month', ...range, count: 1, creating: false,
      editing: { id: 1, masterEventId: null, title: '휴가', startsAt: '2026-10-01T15:00:00Z', endsAt: '2026-10-02T15:00:00Z', allDay: true, location: null, calendarName: null, myRsvpStatus: null, occurrenceDate: null },
    });
    expect(ctx.focus!.facts![0]).toEqual({ label: '일시', value: '2026-10-02 (종일)' });
  });
});
