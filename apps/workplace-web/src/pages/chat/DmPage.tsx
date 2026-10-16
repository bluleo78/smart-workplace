// DM 메시지 뷰 — 기존 메시지 컴포넌트 재사용(DM 채널 id). 헤더는 참여자 기반.
// #345: DM 도 채널이므로 백엔드가 AI 진행 progress 를 fan-out 한다 → ChannelPage 와 동일하게
// onMessagingProgress 를 구독해 작업 중 유령 버블을 렌더(dm.id 기준).
import { MessageSquare, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble'
import { ChannelCatchupCard } from '@/components/chat/ChannelCatchupCard'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DmHeader } from '@/components/chat/DmHeader'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { MessageScrollArea } from '@/components/chat/MessageScrollArea'
import { Page, pageGutterClass } from '@/components/layout/Page'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useChannelCatchup } from '@/hooks/queries/useChannelCatchup'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useAiWorkingBubbles } from '@/hooks/useAiWorkingBubbles'
import { useAuth } from '@/hooks/useAuth'
import { useEntryMaxMessageId } from '@/hooks/useEntryMaxMessageId'
import { onChannelProgress } from '@/hooks/useMessageStream'
import { buildDmContext } from '@/lib/aiScreenContext/builders/messaging'
import { shouldAutoShowCatchup } from '@/lib/catchupGate'
import { catchupWatermark } from '@/lib/catchupWatermark'
import { chatEntryAnchor } from '@/lib/chatEntryAnchor'
import { dmDisplayName } from '@/lib/dm'
import { channelMentionCandidates } from '@/lib/mentionCandidates'
import { firstUnreadMessageId, unreadFromOthersCount } from '@/lib/unreadBoundary'
import { cn } from '@/lib/utils'
import type { DmResponse, UserKind } from '@/types/messaging'

// DM 빈 상태 설명 — self/1:1/그룹 분기.
function dmEmptyDescription(dm: DmResponse, myId: number): string {
  const others = dm.participants.filter((p) => p.userId !== myId)
  if (others.length === 0) return '나에게만 보이는 공간입니다. 메모·링크·할 일을 남겨보세요.'
  if (others.length === 1) return `${others[0].name} 님과의 메시지 시작입니다.`
  // 그룹은 쉼표로 묶인 이름 리스트라 "님" 경어 대신 자연스러운 그룹 문구로.
  return `${others.map((p) => p.name).join(', ')} 님과 함께하는 그룹 대화의 시작입니다.`
}

export default function DmPage() {
  const { id } = useParams()
  const dmId = id ? Number(id) : undefined
  const { user } = useAuth()
  const { data: dms, isLoading, isError, refetch } = useMyDms()
  const { data } = useChannelMessages(dmId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []

  // AI 작업 중 유령 버블 — ChannelPage 와 같은 훅(DM 채널의 channelId === dmId).
  const messagesLoaded = data !== undefined
  const working = useAiWorkingBubbles(dmId, onChannelProgress, messages, messagesLoaded)

  // ── 캐치업(L1) 배선 — ChannelPage 와 동일 로직, dmId 기준. DM 도 채널이므로 watermark·요약 API 재사용.
  const detail = useChannelDetail(dmId)
  // watermark = 서버 원본(null 가능) — 구분선 전용. 새 DM 은 양쪽 모두 null 이라 캐치업은 null→0 해석값을 쓴다(WP-256).
  const watermark = detail.data?.lastReadMessageId ?? null
  const catchupSince = catchupWatermark(detail.data)
  // 진입 시점 최대 메시지 id — 진입 후 도착한 라이브 메시지(내 전송·AI 답글·상대 신규)를 미읽음 경계에서 제외(#491).
  const entryMaxId = useEntryMaxMessageId(dmId, messages, messagesLoaded)
  // 미읽음 = watermark 초과 + 진입 시점 이하(라이브 제외) + 내가 보내지 않은 메시지.
  const unreadDividerBeforeId = firstUnreadMessageId(messages, watermark, user?.id, entryMaxId)
  const unreadCount = unreadFromOthersCount(messages, catchupSince, user?.id, entryMaxId)
  const [catchupManual, setCatchupManual] = useState(false)
  const [catchupDismissed, setCatchupDismissed] = useState(false)
  const showCatchupCard =
    !catchupDismissed && catchupSince != null && (shouldAutoShowCatchup(unreadCount) || catchupManual)
  const showCatchupButton =
    !catchupDismissed && !showCatchupCard && catchupSince != null && unreadCount >= 1 && unreadCount <= 4
  const catchup = useChannelCatchup(dmId, catchupSince, showCatchupCard)
  const markReadFromCatchup = useMarkMessageRead(dmId)
  // 근거/내차례 "원문 보기" → 해당 메시지로 스크롤(메시지 래퍼의 data-testid 앵커).
  const jumpToMessage = (messageId: number) => {
    document
      .querySelector(`[data-testid="message-${messageId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // "확인했어요 → 최신으로" = 최신까지 읽음 처리 + 카드 닫기 + 맨 아래로 점프.
  const confirmCatchup = () => {
    const latest = messages.reduce((mx, m) => (m.id > mx ? m.id : mx), 0)
    if (latest > 0) markReadFromCatchup(latest)
    setCatchupDismissed(true)
    if (latest > 0) jumpToMessage(latest)
  }
  const catchupSlot = showCatchupCard ? (
    <ChannelCatchupCard
      data={catchup.data}
      isLoading={catchup.isLoading}
      isError={catchup.isError}
      onConfirm={confirmCatchup}
      onClose={() => setCatchupDismissed(true)}
      onJumpToMessage={jumpToMessage}
    />
  ) : showCatchupButton ? (
    <div className="mx-4 my-2">
      <button
        type="button"
        data-testid="catchup-summarize-btn"
        onClick={() => setCatchupManual(true)}
        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[12px] font-medium text-indigo-700 hover:bg-indigo-100"
      >
        <Sparkles className="h-3.5 w-3.5" /> 놓친 대화 ✨요약
      </button>
    </div>
  ) : null

  // user 가 없으면 기본값. 정상 흐름에선 ProtectedRoute 가 user 를 보장한다.
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(dmId ?? 0, me)

  const dm = dms?.find((d) => d.id === dmId)

  // WP-54: DM 화면 컨텍스트 — 상대 이름(본인 제외, 헤더 표시와 동일 기준. self-DM 이면 본인).
  const screenContext = useMemo(() => {
    if (!dm || dmId == null) return null
    const others = dm.participants.filter((p) => p.userId !== user?.id)
    const names = (others.length > 0 ? others : dm.participants).map((p) => p.name)
    return buildDmContext({ channelId: dmId, participantNames: names })
  }, [dm, dmId, user?.id])
  useRegisterAiScreenContext(screenContext)
  const aiAvailable = useAiAvailable()
  // @멘션 후보 = DM 참여자(채널과 같은 조립 규칙 — 비멤버 AGENT 추가는 없음).
  // 비서 비가용(aiAvailable=false)이면 AGENT 후보 제외 — AI 와의 DM 자체는 유지, 멘션만 게이트.
  const mentionMembers: MentionCandidate[] = channelMentionCandidates(dm?.participants, undefined, aiAvailable)

  // DM 목록 API 오류 — 로드 실패와 실제 미존재를 구분해 사용자 오해 방지.
  if (isError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
        data-testid="dm-load-error"
      >
        <p className="text-sm text-destructive">대화 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          다시 시도
        </Button>
      </div>
    )
  }

  // 목록 로딩 끝났는데 해당 DM 이 없으면 비참여자/미존재 → 은닉.
  if (!isLoading && !dm) {
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        data-testid="dm-not-found"
      >
        대화를 찾을 수 없습니다.
      </div>
    )
  }
  if (!dm) {
    return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>
  }

  return (
    // 페이지 틀 — DM 헤더(Page.Header) + 자체 레이아웃 본문(메시지 스크롤·입력창이 각자 16px 축을 쓴다).
    <Page>
      <DmHeader dm={dm} currentUserId={me.id} />
      <Page.Body padded={false} className="flex-col">
        <MessageScrollArea
          depKey={`${messages.length}:${messages[0]?.id ?? 0}`}
          initialAnchor={chatEntryAnchor(unreadDividerBeforeId, catchupSlot != null)}
          anchorPending={detail.isPending}
        >
          <MessageList
            messages={messages}
            // 첫 조회 전엔 첨부 뷰어 열림 표식을 지우지 않는다(새로고침 뒤 다시 열기, WP-279).
            ready={messagesLoaded}
            channelId={dm.id}
            currentUserId={me.id}
            members={mentionMembers}
            unreadDividerBeforeId={unreadDividerBeforeId}
            catchupSlot={catchupSlot}
            emptyState={
              data ? (
                <ChatEmptyState
                  icon={<MessageSquare className="h-8 w-8" />}
                  title={dmDisplayName(dm, me.id)}
                  description={dmEmptyDescription(dm, me.id)}
                />
              ) : undefined
            }
          />
        </MessageScrollArea>
        {/* AI 작업 중 유령 버블 — progress 이벤트 발생 시 메시지 목록 하단에 렌더 */}
        {working.size > 0 && (
          <ul className={cn(pageGutterClass, 'pb-1')}>
            {[...working.values()].map((w) => (
              <AiWorkingBubble key={w.streamId} agentName={w.agentName} steps={w.steps} />
            ))}
          </ul>
        )}
        <MessageComposer
          channelId={dm.id}
          members={mentionMembers}
          onSend={(body, fileIds, driveFileIds) =>
            create.mutateAsync({
              body,
              fileIds: fileIds.length ? fileIds : undefined,
              driveFileIds: driveFileIds.length ? driveFileIds : undefined,
            })
          }
        />
      </Page.Body>
    </Page>
  )
}
