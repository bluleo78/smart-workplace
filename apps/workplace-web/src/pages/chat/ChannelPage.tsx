// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
// Phase 5: 우측 스레드 패널(ThreadPanel) — openThreadId state 로 토글.
// A9: AI 에이전트 작업 중 유령 버블 — onMessagingProgress 구독으로 채널별 진행 상태 렌더.
import { Hash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble'
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
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMentionAgents } from '@/hooks/queries/useMentionAgents'
import { useAuth } from '@/hooks/useAuth'
import { type MessagingProgressEvent, onMessagingProgress } from '@/hooks/useMessageStream'
import type { UserKind } from '@/types/messaging'

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
  // 스레드 패널: 어느 부모 메시지 id 가 열려 있는지. null 이면 패널 닫힘.
  const [openThreadId, setOpenThreadId] = useState<number | null>(null)
  // 부모 메시지를 채널 캐시(messages)에서 찾는다.
  const openThreadParent =
    openThreadId != null ? messages.find((m) => m.id === openThreadId) ?? null : null

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
        <MessageScrollArea depKey={`${messages.length}:${messages[0]?.id ?? 0}`}>
          <MessageList
            messages={messages}
            channelId={channel.id}
            currentUserId={me.id}
            members={mentionMembers}
            onOpenThread={setOpenThreadId}
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
          onSend={(body, fileIds) =>
            create.mutateAsync({ body, fileIds: fileIds.length ? fileIds : undefined })
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
          onClose={() => setOpenThreadId(null)}
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
