// 이슈 상태 배지 — 색상/한국어 라벨을 상태별로 매핑한다.

import { Badge } from '@/components/ui/badge';

import type { IssueStatus } from '../../../types/issue';

const STATUS_LABEL: Record<IssueStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

const STATUS_VARIANT: Record<IssueStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  TODO: 'outline',
  IN_PROGRESS: 'default',
  DONE: 'secondary',
  CANCELED: 'destructive',
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
