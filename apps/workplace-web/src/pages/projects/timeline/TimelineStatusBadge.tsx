// 아젠다 에픽 행의 종료 상태 배지(WP-247) — 완료·취소 에픽을 진행 중과 구분한다. 진행 중 상태는 배지 없음.
// 디자인 시스템 StatusBadge 를 감싼다(10px 배지는 타이포·대비 규칙 위반 — WP-245 UI 리뷰).
import { StatusBadge } from '@/components/ui/status-badge';
import type { IssueStatus } from '@/types/issue';

export function TimelineStatusBadge({ status }: { status: IssueStatus }) {
  if (status !== 'DONE' && status !== 'CANCELED') return null;
  return (
    <StatusBadge type={status === 'DONE' ? 'success' : 'inactive'} data-testid="agenda-status-badge" className="ml-1.5 align-middle">
      {status === 'DONE' ? '완료' : '취소'}
    </StatusBadge>
  );
}
