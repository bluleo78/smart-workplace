// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
// Phase 5: 우측 스레드 패널(ThreadPanel) — URL ?thread 로 토글(WP-207, 모바일은 전체폭).
// A9: AI 에이전트 작업 중 유령 버블 — onMessagingProgress 구독으로 채널별 진행 상태 렌더.
import { Hash, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
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
import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { Button } from '@/components/ui/button'
import { useChannelCatchup } from '@/hooks/queries/useChannelCatchup'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMarkMessageRead } from '@/hooks/queries/useMarkMessageRead'
import { useMentionAgents } from '@/hooks/queries/useMentionAgents'
import { useAiAvailable } from '@/hooks/useAiAvailable'
import { useAuth } from '@/hooks/useAuth'
import { useEntryMaxMessageId } from '@/hooks/useEntryMaxMessageId'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { useIsMobile } from '@/hooks/useIsMobile'
import { type MessagingProgressEvent, onMessagingProgress } from '@/hooks/useMessageStream'
import { buildChannelContext } from '@/lib/aiScreenContext/builders/messaging'
import { shouldAutoShowCatchup } from '@/lib/catchupGate'
import { catchupWatermark } from '@/lib/catchupWatermark'
import { chatEntryAnchor } from '@/lib/chatEntryAnchor'
import { parseId } from '@/lib/historyParam'
import { firstUnreadMessageId, unreadFromOthersCount } from '@/lib/unreadBoundary'
import { cn } from '@/lib/utils'
import type { ChannelResponse, MessageResponse, UserKind } from '@/types/messaging'

// WP-54: 채널 화면 컨텍스트 등록 훅. 채널 상세 로드 전/오류 시 null(미등록).
// 메모 의존성은 원시값만 사용 — 메시지 캐시 배열 참조가 바뀌어도 내용이 같으면 재등록하지 않는다.
// (컴포넌트 밖 훅으로 분리: React Compiler 가 본문 내 수동 메모의 보존 불가를 지적하는 것을 피한다.)
function useChannelScreenContext(
  channelId: number | undefined,
  detail: ChannelResponse | undefined,
  threadParent: MessageResponse | null,
) {
  const threadId = threadParent?.id
  const threadAuthor = threadParent?.authorName ?? ''
  const threadBody = threadParent?.body ?? ''
  const threadReplies = threadParent?.replyCount ?? 0
  const name = detail?.name
  const memberCount = detail?.memberCount
  const archived = detail?.archived
  const ctx = useMemo(
    () =>
      name != null && memberCount != null && archived != null && channelId != null
        ? buildChannelContext({
            channelId,
            name,
            memberCount,
            archived,
            thread:
              threadId != null
                ? { id: threadId, authorName: threadAuthor, body: threadBody, replyCount: threadReplies }
                : null,
          })
        : null,
    [channelId, name, memberCount, archived, threadId, threadAuthor, threadBody, threadReplies],
  )
  useRegisterAiScreenContext(ctx)
}

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const detail = useChannelDetail(channelId)
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []
  const { data: channelMembers } = useChannelMembers(channelId)
  const { data: agentCandidates } = useMentionAgents()
  const aiAvailable = useAiAvailable()
  // @멘션 후보 = 채널 멤버 ∪ 워크스페이스 AGENT(비멤버 AGENT 초대용). userId 로 dedup.
  // 비서 비가용(aiAvailable=false)이면 AGENT(=AI) 후보를 제외 — 멘션으로 AI 를 트리거하지 않도록 게이트.
  const mentionMembers: MentionCandidate[] = (() => {
    const byId = new Map<number, MentionCandidate>()
    for (const m of channelMembers ?? [])
      byId.set(m.userId, { userId: m.userId, username: m.name, name: m.name, kind: m.kind })
    for (const a of agentCandidates ?? []) if (!byId.has(a.userId)) byId.set(a.userId, a)
    const all = [...byId.values()]
    return aiAvailable ? all : all.filter((m) => m.kind !== 'AGENT')
  })()
  const [membersOpen, setMembersOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  // 열린 스레드 = URL ?thread(상태의 단일 원천, WP-207). 채널 안 "답글"도 push 라 시스템 뒤로가기가 스레드만 닫는다.
  // 인박스 카드(ThreadsInboxPage)는 기존처럼 ?thread 로 push(마크 없음) → 닫기 = 인박스로 -1.
  // 푸시 알림 콜드 진입은 닫기 = ?thread 만 지우고 채널에 남는다(useHistoryParam 규칙 3).
  const location = useLocation()
  const threadParam = useHistoryParam('thread')
  const openThreadId = parseId(threadParam.value)
  const isMobile = useIsMobile()

  // 패널 parent: 채널 메시지 캐시에서 찾되, 없으면 navigate state(인박스 카드가 넘긴 rootMessage) 사용.
  const stateParent = (location.state as { threadParent?: MessageResponse } | null)?.threadParent
  const openThreadParent =
    openThreadId != null
      ? messages.find((m) => m.id === openThreadId) ??
        (stateParent && stateParent.id === openThreadId ? stateParent : null)
      : null

  // 패널이 실제로 그려질 때만(루트를 찾았을 때만) 모바일 채널 컬럼을 숨긴다 — ?thread 만 보고 숨기면
  // 첫 페이지에 없는 루트·삭제된 루트에서 빈 전체폭 화면이 된다.
  const threadShown = openThreadParent != null
  useHideTabBar(threadShown)

  // WP-54: 채널 화면 컨텍스트 등록 — 채널 + 열린 스레드(루트 메시지).
  useChannelScreenContext(channelId, detail.data, openThreadParent)

  // AI 작업 중 유령 버블 상태 관리 — streamId → 이벤트+타임스탬프 Map.
  // phase done/error 이벤트 수신 시 해당 항목 제거, 신규 AGENT 메시지 도착 시 전체 초기화.
  // IssueChatSection 의 패턴을 channelId 기준으로 동일하게 미러링.
  const [working, setWorking] = useState<Map<string, MessagingProgressEvent & { at: number }>>(
    new Map(),
  )
  // 종료된(done/error) streamId 기록 — fire-and-forget progress POST 의 순서 역전으로 'done' 이후
  // 뒤늦게 도착한 'tool'/'started' 이벤트가 유령 버블을 되살리는 것을 차단(부활 방지).
  const endedStreamsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (channelId == null) return
    return onMessagingProgress((e) => {
      if (e.channelId !== channelId) return
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
  // watermark = 서버 원본(null 가능: 빈 채널 가입·비멤버) — 구분선 전용. 캐치업은 catchupSince 를 쓴다(WP-256).
  const watermark = detail.data?.lastReadMessageId ?? null
  const catchupSince = catchupWatermark(detail.data)
  // 진입 시점 최대 메시지 id — 진입 후 도착한 라이브 메시지(내 전송·AI 답글·남의 신규)를 미읽음 경계에서 제외(#491).
  const entryMaxId = useEntryMaxMessageId(channelId, messages, messagesLoaded)
  // 미읽음 = watermark 초과 + 진입 시점 이하(라이브 제외) + 내가 보내지 않은 메시지.
  const unreadDividerBeforeId = firstUnreadMessageId(messages, watermark, user?.id, entryMaxId)

  // 캐치업 카드 — 진입 시 미읽음을 AI가 요약. 진입-고정 기준점(null→0 해석) + 진입 스냅샷 사용.
  // 자동 임계 게이트용 미읽음 카운트(첫 페이지로 ≥5 판별 충분).
  const unreadCount = unreadFromOthersCount(messages, catchupSince, user?.id, entryMaxId)
  const [catchupManual, setCatchupManual] = useState(false)
  const [catchupDismissed, setCatchupDismissed] = useState(false)
  // 채널 전환 시 카드 상태 리셋(이전 채널의 트리거/닫힘이 새 채널로 새지 않도록).
  useEffect(() => {
    setCatchupManual(false)
    setCatchupDismissed(false)
  }, [channelId])

  const showCatchupCard =
    !catchupDismissed && catchupSince != null && (shouldAutoShowCatchup(unreadCount) || catchupManual)
  const showCatchupButton =
    !catchupDismissed && !showCatchupCard && catchupSince != null && unreadCount >= 1 && unreadCount <= 4
  const catchup = useChannelCatchup(channelId, catchupSince, showCatchupCard)
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
      {/* 채널 본문 컬럼 — 스레드 패널과 가로 분할.
          min-w-0: flex 자식의 기본 min-width:auto 때문에 긴 첨부 파일명의 min-content 폭만큼 컬럼이 부모를 넘어 커지는 것을 막는다. */}
      <div
        data-testid="channel-column"
        className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col', isMobile && threadShown && 'hidden')}
      >
        <ChannelHeader
          channel={channel}
          onOpenMembers={() => setMembersOpen(true)}
          onOpenRename={() => setRenameOpen(true)}
        />
        <MessageScrollArea
          depKey={`${messages.length}:${messages[0]?.id ?? 0}`}
          initialAnchor={chatEntryAnchor(unreadDividerBeforeId, catchupSlot != null)}
        >
          <MessageList
            messages={messages}
            channelId={channel.id}
            currentUserId={me.id}
            members={mentionMembers}
            onOpenThread={(id) => threadParam.open(String(id))}
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
      {/* 스레드 패널 — 루트를 찾았을 때만 렌더. 닫기(✕·‹)는 히스토리 닫기 하나로 통일(WP-207). */}
      {openThreadParent && (
        <ThreadPanel
          channelId={channel.id}
          channelName={channel.name}
          parent={openThreadParent}
          members={mentionMembers}
          me={me}
          archived={channel.archived}
          onClose={threadParam.close}
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
