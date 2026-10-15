// 이슈 변경 이력(STATUS_CHANGED·PRIORITY_CHANGED)의 원시 enum 값을 한국어 표시명으로 바꾼다(WP-412).
// 표시명·원문 폴백은 issueGrouping 의 statusLabel/priorityLabel 을 그대로 써서 목록·보드와 같은 단어가 나오게 하고(드리프트 방지),
// 이력 행 고유 규칙(값 없음 → '없음')만 여기서 더한다.
import { priorityLabel, statusLabel } from '@/lib/issueGrouping';

/** 상태 이력 값 → 표시명. null/빈 값은 '없음'. */
export function historyStatusLabel(v: string | null): string {
  return v ? statusLabel(v) : '없음';
}

/** 우선순위 이력 값 → 표시명. null/빈 값은 '없음'. */
export function historyPriorityLabel(v: string | null): string {
  return v ? priorityLabel(v) : '없음';
}
