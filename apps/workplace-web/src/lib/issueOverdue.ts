// 이슈 마감 초과 판정 — 홈 이슈 목록 위젯 집계(WP-412)와 목록·카드·상세·모바일 칩의 마감 강조(WP-649)가 같은 기준을 쓴다.
import { daysUntilLocalDate } from '@/lib/myTasks';

/**
 * 이슈 하나가 마감을 넘겼는지 — 미완료(DONE/CANCELED 제외) && dueDate < 오늘(브라우저 로컬).
 * 마감일은 로컬 날짜로 비교 — new Date('yyyy-MM-dd') 는 UTC 자정이라 UTC 서쪽에선 오늘 마감이 초과로 잡혔다(WP-415).
 * now 는 테스트 주입용(기본 현재 시각).
 */
export function isOverdue(issue: { status: string; dueDate: string | null }, now: Date = new Date()): boolean {
  if (issue.status === 'DONE' || issue.status === 'CANCELED') return false;
  if (!issue.dueDate) return false;
  return daysUntilLocalDate(issue.dueDate, now) < 0;
}

/** #519: 오늘 기준 마감 초과 건수(isOverdue 인 이슈 수). */
export function countOverdue(items: { status: string; dueDate: string | null }[], now: Date = new Date()): number {
  return items.filter((it) => isOverdue(it, now)).length;
}
