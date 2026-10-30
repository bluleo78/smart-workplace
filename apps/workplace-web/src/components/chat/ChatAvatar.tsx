// 채팅용 아바타 — 올린 프로필 이미지(WP-1222, 앱 루트의 아바타 주소 표에서 userId 로 찾는다) 또는 이니셜 + userId 결정적 색.
// AGENT 는 우하단 봇 배지. 메시지 DTO 에 이미지 주소가 없어도 표로 찾으므로 DTO 를 늘리지 않는다.
import { Bot } from 'lucide-react'

import { AvatarPicture } from '@/components/users/AvatarPicture'
import { avatarInitials } from '@/lib/avatarColor'
import { presenceStyle } from '@/lib/collab/presence'
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
        'bg-presence text-presence-foreground',
        className,
      )}
      style={presenceStyle(userId)}
      aria-hidden
    >
      {/* px 32: 기본 size-8 이 가장 크다(호출부는 size-4~7 로 줄여 쓴다) — 모두 64px 이미지면 충분하다. */}
      <AvatarPicture userId={userId} name={name} px={32}>
        {avatarInitials(name)}
      </AvatarPicture>
      {kind === 'AGENT' && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-ai-accent ring-2 ring-background"
          data-testid={`chat-avatar-agent-${userId}`}
        >
          <Bot className="size-2 text-ai-accent-foreground" />
        </span>
      )}
    </span>
  )
}
