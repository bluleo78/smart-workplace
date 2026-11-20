// 빈 대화 화면(ChatEmptyState)의 다음 행동 버튼 — 채널·DM 페이지가 같은 모양·초점 동작을 쓰도록 한 곳에 둔다(WP-1859).
import { PenLine, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ChatEmptyAction } from '@/lib/chatEmptyAction'

interface ChatEmptyActionButtonProps {
  action: NonNullable<ChatEmptyAction>
  /** 「멤버 초대」 — 채널에서만 의미가 있다. */
  onInvite?: () => void
  /** 「첫 메시지 보내기」 — 입력 칸으로 초점. */
  onCompose: () => void
}

/** 정해진 행동의 버튼 — 행동이 없을 때(null)는 페이지가 이 버튼 대신 action 슬롯을 비운다(빈 여백 방지). */
export function ChatEmptyActionButton({ action, onInvite, onCompose }: ChatEmptyActionButtonProps) {
  if (action === 'invite') {
    return (
      <Button type="button" size="sm" onClick={onInvite}>
        <UserPlus aria-hidden />
        멤버 초대
      </Button>
    )
  }
  return (
    <Button type="button" size="sm" onClick={onCompose}>
      <PenLine aria-hidden />
      첫 메시지 보내기
    </Button>
  )
}
