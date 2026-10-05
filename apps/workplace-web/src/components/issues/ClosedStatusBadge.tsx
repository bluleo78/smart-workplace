// 종료 상태 배지 — 완료·취소된 에픽을 진행 중 항목과 구분한다(에픽 패널·모바일 시트 WP-245, 타임라인 WP-247 공용).
// 진행 중 상태(TODO·IN_PROGRESS)는 배지가 없다(null).
import { cn } from '@/lib/utils';

import type { IssueStatus } from '../../types/issue';

const LABEL: Partial<Record<IssueStatus, string>> = { DONE: '완료', CANCELED: '취소' };

export function ClosedStatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const label = LABEL[status];
  if (!label) return null;
  return (
    <span
      data-testid="closed-status-badge"
      data-status={status}
      className={cn(
        'shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-normal',
        status === 'DONE' ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  );
}
