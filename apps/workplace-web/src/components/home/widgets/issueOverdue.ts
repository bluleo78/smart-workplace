// 이슈 목록 위젯 요약의 마감 초과 집계(WP-412) — IssueListWidget 에서 뺀 순수 함수(화면 없이 단위 테스트로 고정).
import { daysUntilLocalDate } from '@/lib/myTasks';

/**
 * #519: 오늘(브라우저 로컬) 기준 마감 초과 건수 — dueDate < 오늘 && 미완료(DONE/CANCELED 제외).
 * now 는 테스트 주입용(기본 현재 시각).
 */
export function countOverdue(items: { status: string; dueDate: string | null }[], now: Date = new Date()): number {
  return items.filter((it) => {
    if (it.status === 'DONE' || it.status === 'CANCELED') return false;
    if (!it.dueDate) return false;
    // 마감일은 로컬 날짜로 비교 — new Date('yyyy-MM-dd') 는 UTC 자정이라 UTC 서쪽에선 오늘 마감이 초과로 잡혔다(WP-415).
    return daysUntilLocalDate(it.dueDate, now) < 0;
  }).length;
}
