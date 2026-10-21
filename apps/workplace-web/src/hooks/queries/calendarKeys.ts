export const calendarKeys = {
  all: ['calendar'] as const,
  // 범위 목록(range)·딥링크 상세(event)의 공통 접두 — 일정 칩만 바뀌는 변경(태그)은 이것만 무효화한다
  events: ['calendar', 'events'] as const,
  range: (from: string, to: string) => ['calendar', 'events', { from, to }] as const,
  event: (id: number) => ['calendar', 'events', id] as const,
  // 편집 창·홈 위젯 상세(useCalendarEvent.ts 의 ['calendar','event',id])의 접두 — 위 event 와 키가 달라 따로 무효화해야 한다
  eventDetails: ['calendar', 'event'] as const,
  calendars: ['calendar', 'calendars'] as const,
  // 태그 목록 — 구독 주소 키가 이 아래에 있어 tags 만 무효화해도 함께 갱신된다(WP-714·715)
  tags: ['calendar', 'tags'] as const,
  tagFeed: (id: number) => ['calendar', 'tags', id, 'feed'] as const,
}
