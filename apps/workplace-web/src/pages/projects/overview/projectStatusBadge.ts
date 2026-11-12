// 프로젝트 상태 배지(순조로움·주의·위험) 화면 문구와 공용 상태 배지 종류 — 상태 카드(WP-1479)와 리포트 줄·지난 리포트 목록(WP-1483)이 같이 쓴다.
import type { StatusBadgeType } from '@/components/ui/status-badge'
import type { ProjectStatusBadge } from '@/types/projectOverview'

/** 배지별 문구와 색 — 색은 앱 전체와 같게 StatusBadge 의 의미 매핑(성공·주의·오류)을 따른다. */
export const PROJECT_STATUS_BADGE: Record<ProjectStatusBadge, { label: string; type: StatusBadgeType }> = {
  ON_TRACK: { label: '순조로움', type: 'success' },
  WARN: { label: '주의', type: 'warning' },
  RISK: { label: '위험', type: 'error' },
}
