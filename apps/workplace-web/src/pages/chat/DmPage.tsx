// DM 메시지 뷰 — 기존 메시지 컴포넌트 재사용(DM 채널 id). 헤더는 참여자 기반.
import { useParams } from 'react-router-dom'

import { DmHeader } from '@/components/chat/DmHeader'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAuth } from '@/hooks/useAuth'
import type { ChatMemberResponse } from '@/types/chat'
import type { UserKind } from '@/types/messaging'

export default function DmPage() {
  const { id } = useParams()
  const dmId = id ? Number(id) : undefined
  const { user } = useAuth()
  const { data: dms, isLoading } = useMyDms()
  const { data } = useChannelMessages(dmId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []

  // user 가 없으면 기본값. 정상 흐름에선 ProtectedRoute 가 user 를 보장한다.
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(dmId ?? 0, me)

  const dm = dms?.find((d) => d.id === dmId)
  // @멘션 후보 = DM 참여자. RichInput 이 기대하는 chat 멤버 형태로 매핑(username 은 name 으로 대체).
  const mentionMembers: ChatMemberResponse[] = (dm?.participants ?? []).map((p) => ({
    userId: p.userId,
    username: p.name,
    name: p.name,
    kind: p.kind,
    lastReadMessageId: null,
    joinedAt: '',
  }))

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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <MessageComposer
        members={mentionMembers}
        onSend={(body) => create.mutate({ body })}
      />
    </div>
  )
}
