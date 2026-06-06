// 채팅용 아바타 — 이니셜 + userId 결정적 색. AGENT 는 우하단 봇 배지.
// 이미지 URL 이 DTO 에 없으므로 항상 이니셜 폴백을 렌더한다.
import { Bot } from 'lucide-react'

import { avatarColorClass, avatarInitials } from '@/lib/avatarColor'
import { cn } from '@/lib/utils'
import type { UserKind } from '@/types/messaging'

interface ChatAvatarProps {
  userId: number
  name: string
  kind: UserKind
  className?: string
}

export function ChatAvatar({ userId, name, kind, className }: ChatAvatarProps) {
  return (
    <span
      data-testid={`chat-avatar-${userId}`}
      data-kind={kind}
      className={cn(
        'relative flex size-8 shrink-0 select-none items-center justify-center rounded-full text-sm font-medium',
        avatarColorClass(userId),
        className,
      )}
      aria-hidden
    >
      {avatarInitials(name)}
      {kind === 'AGENT' && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-purple-600 ring-2 ring-background"
          data-testid={`chat-avatar-agent-${userId}`}
        >
          <Bot className="size-2 text-white" />
        </span>
      )}
    </span>
  )
}
