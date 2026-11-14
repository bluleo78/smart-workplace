// 대화 빈 상태 — 메시지 0건일 때 "대화의 시작" 안내. 아이콘+제목+설명(+선택 액션).
import type { ReactNode } from 'react'

interface ChatEmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function ChatEmptyState({ icon, title, description, action }: ChatEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center gap-2 px-4 py-12 text-center"
      data-testid="chat-empty-state"
    >
      {icon && <div className="text-muted-foreground">{icon}</div>}
      {/* 공백 없는 긴 채널 이름이 칸 밖으로 넘치지 않게 wrap-anywhere —
          break-word 로는 플렉스 열 안 제목의 min-content 가 줄지 않아 넘친다(WP-1553) */}
      <div className="max-w-full text-base font-semibold wrap-anywhere">{title}</div>
      <p className="max-w-sm text-sm text-muted-foreground wrap-anywhere">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
