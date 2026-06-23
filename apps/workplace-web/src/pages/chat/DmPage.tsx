// DM 메시지 뷰 — 기존 메시지 컴포넌트 재사용(DM 채널 id). 헤더는 참여자 기반.
// #345: DM 도 채널이므로 백엔드가 AI 진행 progress 를 fan-out 한다 → ChannelPage 와 동일하게
// onMessagingProgress 를 구독해 작업 중 유령 버블을 렌더(dm.id 기준).
import { MessageSquare, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble'
import { ChannelCatchupCard } from '@/components/chat/ChannelCatchupCard'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DmHeader } from '@/components/chat/DmHeader'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { MessageScrollArea } from '@/components/chat/MessageScrollArea'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useChannelCatchup } from '@/hooks/queries/useChannelCatchup'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAuth } from '@/hooks/useAuth'
import { type MessagingProgressEvent, onMessagingProgress } from '@/hooks/useMessageStream'
import { shouldAutoShowCatchup } from '@/lib/catchupGate'
import { dmDisplayName } from '@/lib/dm'
import { firstUnreadMessageId } from '@/lib/unreadBoundary'
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

  // AI 작업 중 유령 버블 상태 — streamId → 이벤트+타임스탬프 Map. ChannelPage 의 A9 패턴을
  // dmId 기준으로 미러링한다(DM 채널의 channelId === dmId).
  const [working, setWorking] = useState<Map<string, MessagingProgressEvent & { at: number }>>(
    new Map(),
  )
  // 종료된(done/error) streamId 기록 — fire-and-forget progress POST 의 순서 역전으로 'done' 이후
  // 뒤늦게 도착한 'tool'/'started' 이벤트가 유령 버블을 되살리는 것을 차단(부활 방지).
  const endedStreamsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (dmId == null) return
    return onMessagingProgress((e) => {
      if (e.channelId !== dmId) return
      setWorking((prev) => {
        const next = new Map(prev)
        if (e.phase === 'done' || e.phase === 'error') {
          endedStreamsRef.current.add(e.streamId)
          next.delete(e.streamId)
        } else if (!endedStreamsRef.current.has(e.streamId)) {
          next.set(e.streamId, { ...e, at: Date.now() })
        }
        return next
      })
    })
  }, [dmId])

  // 신규 AGENT 메시지가 도착하면(실제 응답 등장) 모든 유령 버블 제거 — done 이벤트 누락/순서 역전 대비 백스톱.
  // message.id 는 서버 단조 증가 시퀀스이므로 "기준선(초기 로드 시점의 최대 AGENT id) 초과" 만 신규 도착으로 본다.
  // → 스크롤백 페이지네이션(과거 작은 id prepend)·HUMAN 메시지·낙관적 임시 id 는 트리거하지 않는다 (#346).
  const messagesLoaded = data !== undefined
  const maxAgentMsgId = messages.reduce(
    (mx, m) => (m.authorKind === 'AGENT' && m.id > mx ? m.id : mx),
    0,
  )
  const agentBaselineRef = useRef<number | null>(null)
  useEffect(() => {
    if (!messagesLoaded) return // 첫 메시지 로드 전 — 기준선 미설정(라이브 버블 보호)
    // 최초 로드: 기존 AGENT 메시지 최대 id 를 기준선으로 잡는다(0 이어도). 이 run 에서는 절대 제거하지 않는다.
    if (agentBaselineRef.current === null) {
      agentBaselineRef.current = maxAgentMsgId
      return
    }
    if (maxAgentMsgId > agentBaselineRef.current) {
      agentBaselineRef.current = maxAgentMsgId
      setWorking(new Map())
    }
  }, [messagesLoaded, maxAgentMsgId])

  // TTL 안전망: 60초 무수신 유령 제거 (10초마다 스위프)
  useEffect(() => {
    const t = setInterval(() => {
      setWorking((prev) => {
        const cutoff = Date.now() - 60_000
        const next = new Map([...prev].filter(([, v]) => v.at >= cutoff))
        return next.size === prev.size ? prev : next
      })
    }, 10_000)
    return () => clearInterval(t)
  }, [])

  // ── 캐치업(L1) 배선 — ChannelPage 와 동일 로직, dmId 기준. DM 도 채널이므로 watermark·요약 API 재사용.
  const detail = useChannelDetail(dmId)
  const watermark = detail.data?.lastReadMessageId ?? null
  const unreadDividerBeforeId = firstUnreadMessageId(messages, watermark)
  // 로드된 메시지 중 watermark 초과 미삭제 = 미읽음 카운트(자동 임계 게이트).
  const unreadCount =
    watermark != null ? messages.filter((m) => m.id > watermark && !m.deleted).length : 0
  const [catchupManual, setCatchupManual] = useState(false)
  const [catchupDismissed, setCatchupDismissed] = useState(false)
  // DM 전환 시 카드 상태 리셋(이전 DM 의 트리거/닫힘이 새 DM 으로 새지 않도록).
  useEffect(() => {
    setCatchupManual(false)
    setCatchupDismissed(false)
  }, [dmId])
  const showCatchupCard =
    !catchupDismissed && watermark != null && (shouldAutoShowCatchup(unreadCount) || catchupManual)
  const showCatchupButton =
    !catchupDismissed && !showCatchupCard && watermark != null && unreadCount >= 1 && unreadCount <= 4
  const catchup = useChannelCatchup(dmId, watermark, showCatchupCard)
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
  // @멘션 후보 = DM 참여자. RichInput 이 기대하는 chat 멤버 형태로 매핑(username 은 name 으로 대체).
  const mentionMembers: MentionCandidate[] = (dm?.participants ?? []).map((p) => ({
    userId: p.userId,
    username: p.name,
    name: p.name,
    kind: p.kind,
  }))

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
    <div className="flex h-full min-h-0 flex-col">
      <DmHeader dm={dm} currentUserId={me.id} />
      <MessageScrollArea
        depKey={`${messages.length}:${messages[0]?.id ?? 0}`}
        initialAnchorId={unreadDividerBeforeId != null ? 'unread-divider' : undefined}
      >
        <MessageList
          messages={messages}
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
        <ul className="px-4 pb-1">
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
    </div>
  )
}
