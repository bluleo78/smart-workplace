// 이슈 4상태 아이콘 — 할일/진행/완료/취소를 색·모양으로 구분(팀·개인 공통).
// 아이콘 전용이라 접근성 위해 한글 라벨을 aria-label/title 로 노출(role=img).
import { Circle, CircleCheckBig, CircleDashed, CircleX } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/types/issue';

// 한글 라벨 — 아이콘 단독 표시 시 스크린리더/툴팁용.
const STATUS_LABEL: Record<IssueStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

export function IssueStatusIcon({
  status,
  className,
  decorative,
}: {
  status: IssueStatus;
  className?: string;
  // 인접 텍스트(필터 칩/드롭다운 옵션 라벨)와 중복 announce 방지 — true 면 aria-label 대신
  // aria-hidden 만 설정해 순수 장식으로 처리한다 (#657).
  decorative?: boolean;
}) {
  const base = cn('h-[18px] w-[18px] shrink-0', className);
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': `상태: ${STATUS_LABEL[status]}` };
  switch (status) {
    case 'DONE':
      return <CircleCheckBig className={cn(base, 'text-success')} {...a11yProps} />;
    case 'IN_PROGRESS':
      return <CircleDashed className={cn(base, 'text-primary')} {...a11yProps} />;
    case 'CANCELED':
      return <CircleX className={cn(base, 'text-muted-foreground')} {...a11yProps} />;
    default:
      return <Circle className={cn(base, 'text-muted-foreground/60')} {...a11yProps} />;
  }
}
