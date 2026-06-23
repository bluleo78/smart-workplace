// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
// Phase 5: 우측 스레드 패널(ThreadPanel) — openThreadId state 로 토글.
// A9: AI 에이전트 작업 중 유령 버블 — onMessagingProgress 구독으로 채널별 진행 상태 렌더.
import { Hash, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'

import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble'
import { ChannelCatchupCard } from '@/components/chat/ChannelCatchupCard'
import { ChannelHeader } from '@/components/chat/ChannelHeader'
import { ChannelMembersPanel } from '@/components/chat/ChannelMembersPanel'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { MessageScrollArea } from '@/components/chat/MessageScrollArea'
import { RenameChannelModal } from '@/components/chat/RenameChannelModal'
import { ThreadPanel } from '@/components/chat/ThreadPanel'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useChannelCatchup } from '@/hooks/queries/useChannelCatchup'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useMentionAgents } from '@/hooks/queries/useMentionAgents'
import { useAuth } from '@/hooks/useAuth'
import { type MessagingProgressEvent, onMessagingProgress } from '@/hooks/useMessageStream'
import { shouldAutoShowCatchup } from '@/lib/catchupGate'
import { firstUnreadMessageId } from '@/lib/unreadBoundary'
import type { MessageResponse, UserKind } from '@/types/messaging'

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const detail = useChannelDetail(channelId)
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []
  const { data: channelMembers } = useChannelMembers(channelId)
  const { data: agentCandidates } = useMentionAgents()
  // @멘션 후보 = 채널 멤버 ∪ 워크스페이스 AGENT(비멤버 AGENT 초대용). userId 로 dedup.
  const mentionMembers: MentionCandidate[] = (() => {
    const byId = new Map<number, MentionCandidate>()
    for (const m of channelMembers ?? [])
      byId.set(m.userId, { userId: m.userId, username: m.name, name: m.name, kind: m.kind })
    for (const a of agentCandidates ?? []) if (!byId.has(a.userId)) byId.set(a.userId, a)
    return [...byId.values()]
  })()
  const [membersOpen, setMembersOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  // deep-link: ?thread=<rootId> 파라미터로 스레드 패널 자동 오픈.
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const threadParam = searchParams.get('thread')

  // 스레드 패널: 어느 부모 메시지 id 가 열려 있는지. null 이면 패널 닫힘.
  // ?thread= 파라미터가 있으면 초기값으로 사용.
  const [openThreadId, setOpenThreadId] = useState<number | null>(
    threadParam ? Number(threadParam) : null,
  )

  // 인박스 → deep-link 진입: ?thread= 가 바뀌면 해당 스레드를 연다.
  // param 이 사라지면(채널 URL 로 이동) 열린 패널도 닫아 state drift 방지.
  useEffect(() => {
    setOpenThreadId(threadParam ? Number(threadParam) : null)
  }, [threadParam])

  // 패널 parent: 채널 메시지 캐시에서 찾되, 없으면 navigate state(인박스 카드가 넘긴 rootMessage) 사용.
  const stateParent = (location.state as { threadParent?: MessageResponse } | null)?.threadParent
  const openThreadParent =
    openThreadId != null
      ? messages.find((m) => m.id === openThreadId) ??
        (stateParent && stateParent.id === openThreadId ? stateParent : null)
      : null

  // AI 작업 중 유령 버블 상태 관리 — streamId → 이벤트+타임스탬프 Map.
  // phase done/error 이벤트 수신 시 해당 항목 제거, 신규 AGENT 메시지 도착 시 전체 초기화.
  // IssueChatSection 의 패턴을 channelId 기준으로 동일하게 미러링.
  const [working, setWorking] = useState<Map<string, MessagingProgressEvent & { at: number }>>(
    new Map(),
  )
  useEffect(() => {
    if (channelId == null) return
    return onMessagingProgress((e) => {
      if (e.channelId !== channelId) return
      setWorking((prev) => {
        const next = new Map(prev)
        if (e.phase === 'done' || e.phase === 'error') next.delete(e.streamId)
        else next.set(e.streamId, { ...e, at: Date.now() })
        return next
      })
    })
  }, [channelId])

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

  // 채널 상세 워터마크는 방문 중 무효화되지 않아(detail 키 invalidate 없음) 자연히 안정적 → 스냅샷 불필요.
  // ChannelPage 는 detail.data 가 있을 때만 본문 렌더(아래 early-return 보장)하므로 여기선 항상 non-null.
  const unreadDividerBeforeId = firstUnreadMessageId(messages, detail.data?.lastReadMessageId ?? null)

  // 캐치업 카드 — 진입 시 미읽음을 AI가 요약. 구분선과 같은 진입-고정 watermark(detail.lastReadMessageId) 사용.
  const watermark = detail.data?.lastReadMessageId ?? null
  // 로드된 메시지 중 watermark 초과 미삭제 = 미읽음 카운트(자동 임계 게이트용). 첫 페이지로 ≥5 판별 충분.
  const unreadCount =
    watermark != null ? messages.filter((m) => m.id > watermark && !m.deleted).length : 0
  const [catchupManual, setCatchupManual] = useState(false)
  const [catchupDismissed, setCatchupDismissed] = useState(false)
  // 채널 전환 시 카드 상태 리셋(이전 채널의 트리거/닫힘이 새 채널로 새지 않도록).
  useEffect(() => {
    setCatchupManual(false)
    setCatchupDismissed(false)
  }, [channelId])

  const showCatchupCard =
    !catchupDismissed && watermark != null && (shouldAutoShowCatchup(unreadCount) || catchupManual)
  const showCatchupButton =
    !catchupDismissed && !showCatchupCard && watermark != null && unreadCount >= 1 && unreadCount <= 4
  const catchup = useChannelCatchup(channelId, watermark, showCatchupCard)
  const markReadFromCatchup = useMarkMessageRead(channelId)

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

  // user 가 없으면 작성 비활성 대비 기본값. 정상 흐름에선 ProtectedRoute 가 user 를 보장한다.
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(channelId ?? 0, me)

  // 비공개 비멤버 등 404 → 존재 은닉(채널 없음 안내).
  if (detail.isError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
        data-testid="channel-not-found"
      >
        <p className="text-sm text-destructive">채널을 찾을 수 없습니다.</p>
        <Button variant="outline" size="sm" onClick={() => detail.refetch()}>다시 시도</Button>
      </div>
    )
  }

  if (!detail.data) {
    return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>
  }

  const channel = detail.data
  return (
    <div className="flex h-full min-h-0">
      {/* 채널 본문 컬럼 — 스레드 패널과 가로 분할. */}
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ChannelHeader
          channel={channel}
          onOpenMembers={() => setMembersOpen(true)}
          onOpenRename={() => setRenameOpen(true)}
        />
        <MessageScrollArea
          depKey={`${messages.length}:${messages[0]?.id ?? 0}`}
          initialAnchorId={unreadDividerBeforeId != null ? 'unread-divider' : undefined}
        >
          <MessageList
            messages={messages}
            channelId={channel.id}
            currentUserId={me.id}
            members={mentionMembers}
            onOpenThread={setOpenThreadId}
            unreadDividerBeforeId={unreadDividerBeforeId}
            catchupSlot={catchupSlot}
            emptyState={
              data ? (
                <ChatEmptyState
                  icon={<Hash className="h-8 w-8" />}
                  title={`#${channel.name}`}
                  description={`이것은 #${channel.name} 채널의 시작입니다.`}
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
        {/* 아카이브 채널이면 composer 비활성. */}
        <MessageComposer
          channelId={channel.id}
          members={mentionMembers}
          archived={channel.archived}
          onSend={(body, fileIds, driveFileIds) =>
            create.mutateAsync({
              body,
              fileIds: fileIds.length ? fileIds : undefined,
              driveFileIds: driveFileIds.length ? driveFileIds : undefined,
            })
          }
        />
      </div>
      {/* 스레드 패널 — openThreadParent 가 있을 때만 렌더. */}
      {openThreadParent && (
        <ThreadPanel
          channelId={channel.id}
          parent={openThreadParent}
          members={mentionMembers}
          me={me}
          archived={channel.archived}
          onClose={() => {
            setOpenThreadId(null)
            // ?thread= 파라미터가 있었으면 URL 에서도 제거한다(replace — 히스토리 오염 방지).
            if (threadParam) {
              searchParams.delete('thread')
              setSearchParams(searchParams, { replace: true })
            }
          }}
        />
      )}
      <RenameChannelModal
        channelId={channel.id}
        currentName={channel.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ChannelMembersPanel
        channelId={channel.id}
        myRole={channel.role}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
    </div>
  )
}
