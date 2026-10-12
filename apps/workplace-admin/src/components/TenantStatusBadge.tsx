import type { TenantStatus } from '../types/platform'
import { Badge } from './ui/badge'

/**
 * 테넌트 상태 배지 — 목록·상세 공용.
 * 활성=success, 정지됨=warning, 삭제됨=중립 테두리(outline, 복원 가능한 보관 상태라 경고색을 쓰지 않음),
 * 영구 삭제 중=info(백그라운드 진행 표시).
 */
export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  switch (status) {
    case 'SUSPENDED':
      return (
        <Badge variant="warning" data-testid="tenant-status">
          정지됨
        </Badge>
      )
    case 'DELETED':
      return (
        <Badge variant="outline" data-testid="tenant-status">
          삭제됨
        </Badge>
      )
    case 'PURGING':
      return (
        <Badge variant="info" data-testid="tenant-status">
          영구 삭제 중…
        </Badge>
      )
    default:
      return (
        <Badge variant="success" data-testid="tenant-status">
          활성
        </Badge>
      )
  }
}
