// 미니 월 캘린더 공용 클래스 — 데스크톱 사이드바 미니 캘린더와 모바일 헤더 미니 달력(WP-136)이 같은 점 모양을 쓴다.
/** 일정·마감이 있는 날 아래 점(dot) — Calendar modifiersClassNames.hasItems 용. `day-has-items` 는 E2E 판별 표식. */
export const miniCalendarDotClass =
  'day-has-items relative after:absolute after:bottom-0.5 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary'
