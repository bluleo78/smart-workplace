// DM 헤더 — 참여자 기반 표시명. AGENT 배지·인원수는 그룹(3명+)일 때만 표시.
// 오른쪽 「⋯」(대화 메뉴)에는 「대화 숨기기」(WP-1676) — 1:1·그룹·나 혼자 DM 모두.
import { MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Page } from '@/components/layout/Page'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AgentBadge } from '@/components/users/AgentBadge'
import { useHideDm } from '@/hooks/queries/useHideDm'
import { useIsMobile } from '@/hooks/useIsMobile'
import { dmDisplayName, isDmRecipientInactive } from '@/lib/dm'
import type { DmResponse } from '@/types/messaging'

interface DmHeaderProps {
  dm: DmResponse
  currentUserId: number
  /** 모바일에서 스레드를 전체폭으로 열 때 헤더를 숨기는 데 쓴다(ChannelHeader 와 같음, WP-1083). */
  className?: string
}

export function DmHeader({ dm, currentUserId, className }: DmHeaderProps) {
  // 상대 중 AGENT 가 있으면 배지. 인원수는 그룹(본인 포함 3명+)일 때만 표시(1:1·self 의 "2명/1명" 노이즈 제거).
  const hasAgent = dm.participants.some((p) => p.kind === 'AGENT' && p.userId !== currentUserId)
  const displayName = dmDisplayName(dm, currentUserId)
  // 받는 사람이 모두 정지된 DM — 이름 옆에 「비활성」 표시(WP-723). 입력창 자리에는 MessageComposer 가 안내를 띄운다.
  const inactiveBadge = isDmRecipientInactive(dm, currentUserId) && (
    <Badge variant="secondary" className="shrink-0" data-testid="dm-inactive-badge">
      비활성
    </Badge>
  )
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const hideDm = useHideDm()
  // 숨기면 내 목록에서 빠지므로 지금 화면에 머물 곳이 없다 — 대화 첫 화면으로 간다. 실패는 훅이 토스트로 알리고 이 화면에 머문다.
  const onHide = () => hideDm.mutate(dm.id, { onSuccess: () => navigate('/chat') })
  // 대화 메뉴(⋯) — 데스크톱·모바일이 같은 메뉴를 쓴다. 모바일은 헤더 터치 크기(44px)·흐린 글자색으로 다른 모바일 헤더 ⋯ 와 모양을 맞춘다.
  // 모바일도 인라인 글자 단추가 아니라 메뉴로 둔다 — 누르기 쉬워 실수로 숨기지 않게(같은 메뉴에 「대화 나가기」가 붙는다, WP-1677).
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {isMobile ? (
          <button
            type="button"
            aria-label="대화 메뉴"
            data-testid="dm-menu-btn"
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label="대화 메뉴" data-testid="dm-menu-btn">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid="dm-hide-action" disabled={hideDm.isPending} onClick={onHide}>
          대화 숨기기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  if (isMobile) {
    // 모바일: 병합 상세 헤더(‹ + 이름 + ✦) 한 줄 — 레이아웃 뒤로가기 바와 두 줄로 쌓이지 않는다(U1-1).
    return (
      <Page.Header
        data-testid="dm-header"
        className={className}
        title={
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate" title={displayName} data-testid="dm-title">{displayName}</span>
            {hasAgent && <AgentBadge size="xs" />}
            {inactiveBadge}
          </span>
        }
        // 헤더 오른쪽 자리에 대화 메뉴(⋯). actions 를 넘기지 않으므로 공용 ⋯(MobileHeaderMore)는 생기지 않는다.
        mobilePrimaryAction={menu}
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
          {inactiveBadge}
          {dm.participants.length > 2 && (
            <span className="shrink-0 text-xs text-muted-foreground">{dm.participants.length}명</span>
          )}
        </>
      }
      actions={menu}
    />
  )
}
