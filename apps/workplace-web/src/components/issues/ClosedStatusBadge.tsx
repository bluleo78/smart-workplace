// 종료 상태 배지 — 완료·취소된 에픽을 진행 중 항목과 구분한다(에픽 패널·모바일 시트, WP-245).
// 디자인 시스템 StatusBadge(의미 기반 색·label 크기)를 쓴다 — 완료=success, 취소=inactive. 진행 중 상태(TODO·IN_PROGRESS)는 배지가 없다(null).
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';

import type { IssueStatus } from '../../types/issue';

export function ClosedStatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  if (status !== 'DONE' && status !== 'CANCELED') return null;
  return (
    <StatusBadge
      type={status === 'DONE' ? 'success' : 'inactive'}
      data-testid="closed-status-badge"
      data-status={status}
      className={cn('shrink-0', className)}
    >
      {status === 'DONE' ? '완료' : '취소'}
    </StatusBadge>
  );
}
