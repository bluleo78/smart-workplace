// DM 헤더 — 참여자 기반 표시명. AGENT 배지·인원수는 그룹(3명+)일 때만 표시.
import { AgentBadge } from '@/components/users/AgentBadge'
import { dmDisplayName } from '@/lib/dm'
import type { DmResponse } from '@/types/messaging'

interface DmHeaderProps {
  dm: DmResponse
  currentUserId: number
}

export function DmHeader({ dm, currentUserId }: DmHeaderProps) {
  // 상대 중 AGENT 가 있으면 배지. 인원수는 그룹(본인 포함 3명+)일 때만 표시(1:1·self 의 "2명/1명" 노이즈 제거).
  const hasAgent = dm.participants.some((p) => p.kind === 'AGENT' && p.userId !== currentUserId)
  return (
    <header className="flex items-center gap-2 border-b px-4 py-2" data-testid="dm-header">
      <span className="font-semibold" data-testid="dm-title">
        {dmDisplayName(dm, currentUserId)}
      </span>
      {hasAgent && <AgentBadge size="xs" />}
      {dm.participants.length > 2 && (
        <span className="text-xs text-muted-foreground">{dm.participants.length}명</span>
      )}
    </header>
  )
}
