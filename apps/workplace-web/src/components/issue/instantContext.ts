import type { AiSignalVariant } from '@/components/ai/aiMarker'
import type { IssueBlockerBadge } from '@/types/issue'

// 블로커 타입 → AiSignalBadge variant 매핑.
// AiSignalVariant 실제 어휘: 'action'(사용자 행동 필요) | 'info'(정보성).
// BLOCKED/OVERDUE = 즉각 행동 필요 → 'action', STALE = 정보성 알림 → 'info'.
export function badgeVariant(type: IssueBlockerBadge['type']): AiSignalVariant {
  if (type === 'BLOCKED') return 'action'
  if (type === 'OVERDUE') return 'action'
  return 'info'
}
