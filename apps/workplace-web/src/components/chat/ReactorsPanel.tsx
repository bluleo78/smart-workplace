// 반응자 전체 목록(WP-106) — 이모지별 탭 + 탭마다 무한 스크롤 목록. 데스크톱 다이얼로그·모바일 시트가 함께 쓴다.
// 탭 목록·개수는 열린 메시지의 최신 reactions 에서 매 렌더 계산한다 — 열린 동안 SSE 로 개수가 바뀌면 그대로 반영되고,
// 보고 있던 이모지가 0 이 되어 사라지면 첫 탭으로 옮겨간다. 내 행은 1페이지 맨 앞에 "나" 태그로 두고 서버 목록에선 뺀다.
import { useState } from 'react'

import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useReactors } from '@/hooks/queries/useReactors'
import { othersOf } from '@/lib/reactorSummary'
import type { MessageResponse, ReactionResponse } from '@/types/messaging'

export function ReactorsPanel({
  message,
  initialEmoji,
  currentUserId,
  meName,
}: {
  message: MessageResponse
  initialEmoji: string
  currentUserId: number
  meName: string
}) {
  const [picked, setPicked] = useState(initialEmoji)
  // 고른 이모지가 사라졌으면 첫 탭으로.
  const active = message.reactions.some((r) => r.emoji === picked) ? picked : message.reactions[0]?.emoji
  if (!active) return null
  return (
    <Tabs value={active} onValueChange={setPicked} className="min-h-0 flex-1">
      <TabsList className="w-full justify-start overflow-x-auto">
        {message.reactions.map((r) => (
          <TabsTrigger key={r.emoji} value={r.emoji} data-testid={`reactors-tab-${r.emoji}`}>
            <span>{r.emoji}</span>
            <span className="text-xs tabular-nums">{r.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {message.reactions.map((r) => (
        <TabsContent key={r.emoji} value={r.emoji} className="min-h-0">
          {/* 활성 탭만 마운트(Radix 기본) → 그 이모지만 조회. */}
          <ReactorList messageId={message.id} reaction={r} currentUserId={currentUserId} meName={meName} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** 한 이모지의 반응자 목록 — 나(reacted) 먼저, 이후 받은 순서. 끝에 닿으면 다음 페이지. */
function ReactorList({
  messageId,
  reaction,
  currentUserId,
  meName,
}: {
  messageId: number
  reaction: ReactionResponse
  currentUserId: number
  meName: string
}) {
  const q = useReactors(messageId, reaction.emoji)
  // 스크롤 컨테이너는 state 로 보관한다(ref 는 첫 렌더에 null) — 다른 무한 스크롤 목록과 같은 방식.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const allItems = q.data?.pages.flatMap((p) => p.items) ?? []
  // 내 행 — 받은 페이지에 내가 있으면 그 항목(이름·종류)을, 없어도 칩이 reacted 면 meName 으로 맨 앞에 둔다.
  const meItem = allItems.find((r) => r.userId === currentUserId)
  const showMe = reaction.reacted || !!meItem
  const others = othersOf(allItems, currentUserId)
  return (
    <div ref={setScrollEl} className="max-h-80 overflow-y-auto py-1">
      {showMe && (
        <ReactorRow
          testId="reactor-row-me"
          userId={currentUserId}
          name={meItem?.name ?? meName}
          kind={meItem?.kind ?? 'HUMAN'}
          me
        />
      )}
      {others.map((r) => (
        <ReactorRow key={r.userId} testId={`reactor-row-${r.userId}`} userId={r.userId} name={r.name} kind={r.kind} />
      ))}
      {q.isPending && <p className="py-3 text-center text-xs text-muted-foreground">불러오는 중…</p>}
      {q.isLoadingError && (
        <button type="button" className="w-full py-3 text-xs text-destructive underline" onClick={() => void q.refetch()}>
          불러오지 못했습니다 — 다시 시도
        </button>
      )}
      <LoadMoreFooter query={q} root={scrollEl} />
    </div>
  )
}

/** 반응자 1행 — 아바타(AGENT 봇 배지) + 이름, 나면 "나" 태그. */
function ReactorRow({
  testId,
  userId,
  name,
  kind,
  me = false,
}: {
  testId: string
  userId: number
  name: string
  kind: MessageResponse['authorKind']
  me?: boolean
}) {
  return (
    <div data-testid={testId} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">
      <ChatAvatar userId={userId} name={name} kind={kind} className="size-7 text-xs" />
      <span className="truncate">{name}</span>
      {me && <span className="ml-auto rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">나</span>}
    </div>
  )
}
