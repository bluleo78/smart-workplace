// 이슈 상태 배지 — 색은 범주(할 일·진행 중·완료·취소)로, 글자는 프로젝트 상태 이름으로 보인다(WP-808).

import { StatusBadge, type StatusBadgeType } from '@/components/ui/status-badge';

import { statusLabel } from '../../../lib/issueGrouping';
import type { IssueStatus } from '../../../types/issue';

// DS §B-1 시맨틱 매핑 — CANCELED 는 error(빨강)로 두면 상단 "차단됨" 배지와 색이 겹치므로 inactive(회색)로 구분.
const STATUS_TYPE: Record<IssueStatus, StatusBadgeType> = {
  TODO: 'pending',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELED: 'inactive',
};

/** name = 응답의 statusName(프로젝트 상태 이름). 없으면(링크 요약 등 범주만 아는 곳) 범주 라벨. */
export function IssueStatusBadge({ status, name }: { status: IssueStatus; name?: string }) {
  return <StatusBadge type={STATUS_TYPE[status]}>{statusLabel(status, name)}</StatusBadge>;
}
