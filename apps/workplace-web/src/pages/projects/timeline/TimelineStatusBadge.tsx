// 아젠다 에픽 행의 종료 상태 배지(WP-247) — 완료·취소 에픽을 진행 중과 구분한다. 진행 중 상태는 배지 없음.
// 디자인 시스템 StatusBadge 를 감싼다(10px 배지는 타이포·대비 규칙 위반 — WP-245 UI 리뷰).
import type { ComponentProps } from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';

export function TimelineStatusBadge({ status, className, ...props }: { status: IssueStatus } & ComponentProps<'span'>) {
  if (status !== 'DONE' && status !== 'CANCELED') return null;
  return (
    <StatusBadge
      {...props}
      type={status === 'DONE' ? 'success' : 'inactive'}
      data-testid="agenda-status-badge"
      // className 은 펼침 뒤에 둬야 기본 여백(ml-1.5)이 호출부 className 에 덮여 사라지지 않는다.
      className={cn('ml-1.5 align-middle', className)}
    >
      {status === 'DONE' ? '완료' : '취소'}
    </StatusBadge>
  );
}
