// 버전 상태 배지(WP-888) — 미출시·출시됨·보관됨. 색은 의미(StatusBadge)로 정한다.
import { StatusBadge, type StatusBadgeType } from '@/components/ui/status-badge';

import { VERSION_STATUS_LABEL, type VersionStatus } from '../../../types/version';

// 미출시는 대기(테두리), 출시됨은 성공(녹색), 보관됨은 비활성(회색).
const TYPE: Record<VersionStatus, StatusBadgeType> = {
  UNRELEASED: 'pending',
  RELEASED: 'success',
  ARCHIVED: 'inactive',
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  return <StatusBadge type={TYPE[status]}>{VERSION_STATUS_LABEL[status]}</StatusBadge>;
}
