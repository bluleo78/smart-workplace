// DM 메시지 뷰 — 기존 메시지 컴포넌트 재사용(DM 채널 id). 헤더는 참여자 기반.
import { MessageSquare } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { DmHeader } from '@/components/chat/DmHeader'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import { MessageScrollArea } from '@/components/chat/MessageScrollArea'
import type { MentionCandidate } from '@/components/mentions/types'
import { useChannelMessages } from '@/hooks/queries/useChannelMessages'
import { useCreateMessage } from '@/hooks/queries/useCreateMessage'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useAuth } from '@/hooks/useAuth'
import { dmDisplayName } from '@/lib/dm'
import type { DmResponse, UserKind } from '@/types/messaging'

// DM 빈 상태 설명 — self/1:1/그룹 분기.
function dmEmptyDescription(dm: DmResponse, myId: number): string {
  const others = dm.participants.filter((p) => p.userId !== myId)
  if (others.length === 0) return '나에게만 보이는 공간입니다. 메모·링크·할 일을 남겨보세요.'
  if (others.length === 1) return `${others[0].name} 님과의 다이렉트 메시지 시작입니다.`
  // 그룹은 쉼표로 묶인 이름 리스트라 "님" 경어 대신 자연스러운 그룹 문구로.
  return `${others.map((p) => p.name).join(', ')} 님과 함께하는 그룹 대화의 시작입니다.`
}

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
  const mentionMembers: MentionCandidate[] = (dm?.participants ?? []).map((p) => ({
    userId: p.userId,
    username: p.name,
    name: p.name,
    kind: p.kind,
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
      <MessageScrollArea depKey={`${messages.length}:${messages[0]?.id ?? 0}`}>
        <MessageList
          messages={messages}
          channelId={dm.id}
          currentUserId={me.id}
          members={mentionMembers}
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
      <MessageComposer
        channelId={dm.id}
        members={mentionMembers}
        onSend={(body, fileIds) =>
          create.mutate({ body, fileIds: fileIds.length ? fileIds : undefined })
        }
      />
    </div>
  )
}
