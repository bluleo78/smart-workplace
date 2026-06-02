// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
// Phase 5: 우측 스레드 패널(ThreadPanel) — openThreadId state 로 토글.
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { ChannelHeader } from '@/components/chat/ChannelHeader'
import { ChannelMembersPanel } from '@/components/chat/ChannelMembersPanel'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { RenameChannelModal } from '@/components/chat/RenameChannelModal'
import { ThreadPanel } from '@/components/chat/ThreadPanel'
import type { MentionCandidate } from '@/components/mentions/types'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useMentionAgents } from '@/hooks/queries/useMentionAgents'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useAuth } from '@/hooks/useAuth'
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

  // user 가 없으면 작성 비활성 대비 기본값. 정상 흐름에선 ProtectedRoute 가 user 를 보장한다.
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(channelId ?? 0, me)

  // 비공개 비멤버 등 404 → 존재 은닉(채널 없음 안내).
  if (detail.isError) {
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        data-testid="channel-not-found"
      >
        채널을 찾을 수 없습니다.
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageList
            messages={messages}
            channelId={channel.id}
            currentUserId={me.id}
            members={mentionMembers}
            onOpenThread={setOpenThreadId}
          />
        </div>
        {/* 아카이브 채널이면 composer 비활성. */}
        <MessageComposer
          members={mentionMembers}
          disabled={channel.archived}
          onSend={(body) => create.mutate({ body })}
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
