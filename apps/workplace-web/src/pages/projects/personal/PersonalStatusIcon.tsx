// 개인 작업 4상태 아이콘 — 할일/진행/완료/취소를 색·모양으로 구분.
import { Circle, CircleCheckBig, CircleDashed, CircleX } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';

export function PersonalStatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const base = cn('h-[18px] w-[18px] shrink-0', className);
  switch (status) {
    case 'DONE':
      return <CircleCheckBig className={cn(base, 'text-success')} aria-hidden />;
    case 'IN_PROGRESS':
      return <CircleDashed className={cn(base, 'text-primary')} aria-hidden />;
    case 'CANCELED':
      return <CircleX className={cn(base, 'text-muted-foreground')} aria-hidden />;
    default:
      return <Circle className={cn(base, 'text-muted-foreground/60')} aria-hidden />;
  }
}
