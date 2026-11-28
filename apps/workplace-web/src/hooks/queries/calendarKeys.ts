export const calendarKeys = {
  all: ['calendar'] as const,
  // 범위 목록(range)·딥링크 상세(event)의 공통 접두 — 일정 칩만 바뀌는 변경(태그)은 이것만 무효화한다
  events: ['calendar', 'events'] as const,
  range: (from: string, to: string) => ['calendar', 'events', { from, to }] as const,
  event: (id: number) => ['calendar', 'events', id] as const,
  // 편집 창·홈 위젯 상세(useCalendarEvent.ts 의 ['calendar','event',id])의 접두 — 위 event 와 키가 달라 따로 무효화해야 한다
  eventDetails: ['calendar', 'event'] as const,
  calendars: ['calendar', 'calendars'] as const,
  // 새 일정 기본 캘린더 설정(WP-2169) — all 접두 밖이라 일정 변경 무효화에는 다시 읽지 않는다. 캘린더 생성·수정·삭제 훅이 명시적으로 무효화한다
  // (삭제로 지정이 풀리면 Works 로 돌아온다)
  calendarSettings: ['calendar-settings'] as const,
  // 태그 목록 — 구독 주소 키가 이 아래에 있어 tags 만 무효화해도 함께 갱신된다(WP-714·715)
  tags: ['calendar', 'tags'] as const,
  // 일정(회차)의 회의록 노트(WP-1701) — all 접두라 일정 변경 무효화 때 함께 다시 읽는다
  eventNote: (id: number, occurrenceDate: string | null) => ['calendar', 'note', id, occurrenceDate] as const,
  // 노트에 이어진 일정 목록(WP-1703) — all 접두라 일정 변경 무효화 때 함께 다시 읽는다
  noteEventsAll: ['calendar', 'noteEvents'] as const,
  noteEvents: (pageId: number) => ['calendar', 'noteEvents', pageId] as const,
  tagFeed: (id: number) => ['calendar', 'tags', id, 'feed'] as const,
}
