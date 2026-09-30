// 캘린더 화면 컨텍스트 builder(WP-54). 반복 회차는 get_event 가 마스터를 돌려주므로 eventId=masterEventId ?? id,
// 회차 기준 일시·회차일을 facts 로 함께 보내 "이 회의" 가 어느 회차인지 AI 가 알게 한다.
import { CALENDAR_VIEW_LABEL } from '@/lib/calendar';
import type { AiScreenContext } from '@/types/aiScreenContext';
import type { CalendarViewType } from '@/types/calendar';

import { buildFacts, buildRefs, clip, fmtKst, LIMITS, withListState } from '../common';

/** 캘린더 화면 입력 — editing 은 열린 일정 다이얼로그의 대상(CalendarEvent 의 부분 집합). */
export interface CalendarContextInput {
  view: CalendarViewType;
  from: string;
  to: string;
  /** 일정 조회 전에는 undefined — 0건으로 오인시키지 않도록 scope.count 를 싣지 않는다. */
  count?: number;
  creating: boolean;
  editing: {
    id: number;
    masterEventId: number | null;
    title: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    location: string | null;
    calendarName: string | null;
    myRsvpStatus: string | null;
    occurrenceDate: string | null;
  } | null;
}

/** 캘린더 화면 → AI 화면 컨텍스트. scope=보기·표시 기간·일정 수, focus=열린(또는 작성 중인) 일정. */
export function buildCalendarContext(input: CalendarContextInput): AiScreenContext {
  // 표시 기간 — visibleRange 의 to 는 배타 경계(다음 날 00:00)라 표시는 1ms 뺀 날짜로. refs 는 원본 ISO 유지(list_events 인자).
  const toInclusive = new Date(new Date(input.to).getTime() - 1).toISOString();
  const scope = withListState(
    {
      // 사용자가 보는 보기 탭 이름('월'·'주'·'일'·'목록') + ' 보기' — 화면과 AI 가 같은 단어를 쓴다.
      label: `${CALENDAR_VIEW_LABEL[input.view]} 보기`,
      refs: buildRefs({ from: input.from, to: input.to }),
      facts: buildFacts([['기간', `${fmtKst(input.from, false)} ~ ${fmtKst(toInclusive, false)}`]]),
    },
    { count: input.count },
  );
  const ctx: AiScreenContext = { view: '캘린더', scope };

  const e = input.editing;
  if (e) {
    const when = e.allDay ? `${fmtKst(e.startsAt, false)} (종일)` : `${fmtKst(e.startsAt)} ~ ${fmtKst(e.endsAt)}`;
    ctx.focus = {
      type: '일정',
      label: clip(e.title || '(제목 없음)', LIMITS.label),
      refs: buildRefs({ eventId: e.masterEventId ?? e.id }),
      facts: buildFacts([
        ['일시', when],
        ['반복 회차일', e.occurrenceDate],
        ['장소', e.location],
        ['캘린더', e.calendarName],
        ['내 응답', e.myRsvpStatus],
      ]),
    };
  } else if (input.creating) {
    ctx.focus = { type: '일정', label: '새 일정 작성 중', refs: {} };
  }
  return ctx;
}
