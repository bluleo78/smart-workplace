// 채널 메시지 뷰 — 히스토리 + 실시간(상위 ChatModuleLayout 이 구독) + optimistic 전송.
import { useParams } from 'react-router-dom'

import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useAuth } from '@/hooks/useAuth'
import type { UserKind } from '@/types/messaging'

export default function ChannelPage() {
  const { id } = useParams()
  const channelId = id ? Number(id) : undefined
  const { user } = useAuth()
  const { data } = useChannelMessages(channelId)
  const messages = data?.pages.flatMap((p) => p.items) ?? []

  // user 가 없으면 작성 비활성 대비 기본값. 정상 흐름에선 ProtectedRoute 가 user 를 보장한다.
  const me = user
    ? { id: user.id, name: user.name, kind: (user.kind ?? 'HUMAN') as UserKind }
    : { id: 0, name: '', kind: 'HUMAN' as UserKind }
  const create = useCreateMessage(channelId ?? 0, me)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <MessageComposer onSend={(body) => create.mutate({ body })} />
    </div>
  )
}
