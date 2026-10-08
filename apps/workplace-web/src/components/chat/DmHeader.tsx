// DM 헤더 — 참여자 기반 표시명. AGENT 배지·인원수는 그룹(3명+)일 때만 표시.
import { Page } from '@/components/layout/Page'
import { AgentBadge } from '@/components/users/AgentBadge'
import { useIsMobile } from '@/hooks/useIsMobile'
import { dmDisplayName } from '@/lib/dm'
import type { DmResponse } from '@/types/messaging'

interface DmHeaderProps {
  dm: DmResponse
  currentUserId: number
}

export function DmHeader({ dm, currentUserId }: DmHeaderProps) {
  // 상대 중 AGENT 가 있으면 배지. 인원수는 그룹(본인 포함 3명+)일 때만 표시(1:1·self 의 "2명/1명" 노이즈 제거).
  const hasAgent = dm.participants.some((p) => p.kind === 'AGENT' && p.userId !== currentUserId)
  const displayName = dmDisplayName(dm, currentUserId)
  const isMobile = useIsMobile()
  if (isMobile) {
    // 모바일: 병합 상세 헤더(‹ + 이름 + ✦) 한 줄 — 레이아웃 뒤로가기 바와 두 줄로 쌓이지 않는다(U1-1).
    return (
      <Page.Header
        data-testid="dm-header"
        title={
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate" title={displayName} data-testid="dm-title">{displayName}</span>
            {hasAgent && <AgentBadge size="xs" />}
          </span>
        }
      />
    )
  }
  // 데스크톱: 페이지 표준 헤더(Page.Header) — 채널 헤더와 같은 h-14 바·16px 축으로 메시지·입력창과 시작선을 맞춘다.
  // 제목 슬롯 안 span 이 말줄임 대상(block truncate) — 긴 표시명 #797 회귀 테스트가 이 요소의 넘침을 본다.
  return (
    <Page.Header
      data-testid="dm-header"
      title={
        <span className="block truncate" title={displayName} data-testid="dm-title">
          {displayName}
        </span>
      }
      meta={
        <>
          {hasAgent && <AgentBadge size="xs" />}
          {dm.participants.length > 2 && (
            <span className="shrink-0 text-xs text-muted-foreground">{dm.participants.length}명</span>
          )}
        </>
      }
    />
  )
}
