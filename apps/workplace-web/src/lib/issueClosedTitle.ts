import { isClosedStatus } from './issueGrouping';

/**
 * 제목 링크가 hover:underline 을 쓸 때 함께 붙인다 — 취소 제목(line-through)은 호버 때 밑줄과 삭선을 함께 그려
 * 밑줄이 삭선을 덮지 않게 한다(목록 행·표·상세 하위·관계 줄이 같은 규칙, WP-2100·WP-2101).
 */
export const CLOSED_TITLE_HOVER_DECORATION = 'hover:[&.line-through]:[text-decoration-line:underline_line-through]';

// 사용자 정의 상태 이름이나 종료 시각과 무관하게 상태 범주로 제목의 색과 삭선을 정한다.
// hoverClass: 행(group)에 마우스를 올릴 때의 제목 색 — 기본은 원래 글자색, 행 호버 색이 따로 있는 곳(홈 위젯 강조색)은 그 색, 호버가 없는 곳은 ''.
export function issueClosedTitleClass(status: string, hoverClass = 'group-hover:text-foreground'): string {
  if (!isClosedStatus(status)) return '';

  const closedTitleClass = hoverClass ? `text-muted-foreground ${hoverClass}` : 'text-muted-foreground';
  return status === 'CANCELED' ? `${closedTitleClass} line-through` : closedTitleClass;
}
