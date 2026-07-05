// 이슈 상태 배지 — 색상/한국어 라벨을 상태별로 매핑한다.

import { StatusBadge, type StatusBadgeType } from '@/components/ui/status-badge';

import type { IssueStatus } from '../../../types/issue';

const STATUS_LABEL: Record<IssueStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

// DS §B-1 시맨틱 매핑 — CANCELED 는 error(빨강)로 두면 상단 "차단됨" 배지와 색이 겹치므로 inactive(회색)로 구분.
const STATUS_TYPE: Record<IssueStatus, StatusBadgeType> = {
  TODO: 'pending',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELED: 'inactive',
};

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return <StatusBadge type={STATUS_TYPE[status]}>{STATUS_LABEL[status]}</StatusBadge>;
}
