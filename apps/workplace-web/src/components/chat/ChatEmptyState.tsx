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
      <div className="text-base font-semibold">{title}</div>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
