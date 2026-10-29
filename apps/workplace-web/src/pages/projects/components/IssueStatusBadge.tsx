// 이슈 상태 배지 — 색은 범주(할 일·진행 중·완료·취소)로, 글자는 프로젝트 상태 이름으로 보인다(WP-808).

import { StatusBadge } from '@/components/ui/status-badge';
import { ISSUE_STATUS_BADGE_TYPE } from '@/lib/issueStatusBadgeType';

import { statusLabel } from '../../../lib/issueGrouping';
import type { IssueStatus } from '../../../types/issue';

/**
 * name = 응답의 statusName(프로젝트 상태 이름). 없으면(구 서버 응답 등 범주만 아는 곳) 범주 라벨.
 * className 으로 폭을 줄이면(예: 의존성 행의 shrink·max-w) 30자 이름이 말줄임되고 전체 이름은 title 로 보인다.
 */
export function IssueStatusBadge({ status, name, className }: { status: IssueStatus; name?: string; className?: string }) {
  const label = statusLabel(status, name);
  return (
    <StatusBadge type={ISSUE_STATUS_BADGE_TYPE[status]} className={className} title={label}>
      <span className="min-w-0 truncate">{label}</span>
    </StatusBadge>
  );
}
