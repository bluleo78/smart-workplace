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
