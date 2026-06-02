// DM 헤더 — 참여자 기반 표시명 + 인원수. 채널과 달리 이름변경/멤버관리/아카이브 없음.
import { dmDisplayName } from '@/lib/dm'
import type { DmResponse } from '@/types/messaging'

interface DmHeaderProps {
  dm: DmResponse
  currentUserId: number
}

export function DmHeader({ dm, currentUserId }: DmHeaderProps) {
  return (
    <header className="flex items-center gap-2 border-b px-4 py-2" data-testid="dm-header">
      <span className="font-semibold" data-testid="dm-title">
        {dmDisplayName(dm, currentUserId)}
      </span>
      <span className="text-xs text-muted-foreground">{dm.participants.length}명</span>
    </header>
  )
}
