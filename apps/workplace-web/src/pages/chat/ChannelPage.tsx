// 채널 메시지 뷰 — 헤더 + 히스토리 + 실시간 + optimistic 전송. 비공개 비멤버는 404 → 채널 없음.
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { ChannelHeader } from '@/components/chat/ChannelHeader'
import { ChannelMembersPanel } from '@/components/chat/ChannelMembersPanel'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { RenameChannelModal } from '@/components/chat/RenameChannelModal'
import { useChannelDetail } from '@/hooks/queries/useChannelDetail'
import { useChannelMembers } from '@/hooks/queries/useChannelMembers'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useAuth } from '@/hooks/useAuth'
import type { ChatMemberResponse } from '@/types/chat'
import type { UserKind } from '@/types/messaging'

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const detail = useChannelDetail(channelId)
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []
  // @멘션 후보 = 채널 멤버. RichInput 이 기대하는 chat 멤버 형태로 매핑(username 은 name 으로 대체).
  const { data: channelMembers } = useChannelMembers(channelId)
  const mentionMembers: ChatMemberResponse[] = (channelMembers ?? []).map((m) => ({
    userId: m.userId,
    username: m.name,
    name: m.name,
    kind: m.kind,
    lastReadMessageId: null,
    joinedAt: m.joinedAt,
  }))
  const [membersOpen, setMembersOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

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
    <div className="flex h-full min-h-0 flex-col">
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
        />
      </div>
      {/* 아카이브 채널이면 composer 비활성. */}
      <MessageComposer
        members={mentionMembers}
        disabled={channel.archived}
        onSend={(body) => create.mutate({ body })}
      />
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
