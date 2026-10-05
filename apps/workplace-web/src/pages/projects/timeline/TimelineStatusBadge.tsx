// 아젠다 에픽 행의 종료 상태 배지(WP-247) — 완료·취소 에픽을 진행 중과 구분한다. 진행 중 상태는 배지 없음.
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import type { IssueStatus } from '@/types/issue';

export function TimelineStatusBadge({ status, ...props }: { status: IssueStatus } & React.ComponentProps<'span'>) {
  if (status !== 'DONE' && status !== 'CANCELED') return null;
  const type = status === 'DONE' ? 'success' : 'inactive';
  const text = status === 'DONE' ? '완료' : '취소';
  return (
    <StatusBadge
      type={type}
      data-testid="agenda-status-badge"
      className={cn('ml-1.5 align-middle', props.className)}
      {...props}
    >
      {text}
    </StatusBadge>
  );
}
