import type { StatusBadgeType } from '@/components/ui/status-badge'
import type { IssueStatus } from '@/types/issue'

/**
 * 이슈 상태 범주 → 배지 의미 색(DS §B-1) — 상태 배지(IssueStatusBadge)와 노트 앱 링크 칩의 상태 점(WP-1147)이 같이 쓴다.
 * CANCELED 는 error(빨강)로 두면 상단 "차단됨" 배지와 색이 겹치므로 inactive(회색)로 구분.
 */
export const ISSUE_STATUS_BADGE_TYPE: Record<IssueStatus, StatusBadgeType> = {
  TODO: 'pending',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELED: 'inactive',
}

/**
 * 배지 대신 작은 점으로 이슈 상태를 보일 때의 색(노트 앱 링크 칩, WP-1147·WP-1185) — 바로 위 배지 종류와 같은 의미 색이다.
 * 대기(TODO)는 배지처럼 테두리만, 취소는 회색. 상태 색을 이 파일 한 곳에서 정해 배지와 점이 어긋나지 않게 한다.
 */
export const ISSUE_STATUS_DOT_CLASS: Record<IssueStatus, string> = {
  TODO: 'border border-muted-foreground',
  IN_PROGRESS: 'bg-info',
  DONE: 'bg-success',
  CANCELED: 'bg-muted-foreground',
}
