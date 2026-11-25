// 대화 빈 상태 — 메시지 0건일 때 "대화의 시작" 안내. 아이콘+제목+설명(+선택 액션).
import type { ReactNode } from 'react'

import { emptyStateDescriptionClass, emptyStateTitleClass } from '@/components/layout/empty-state'
import { cn } from '@/lib/utils'

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
      {/* 제목·설명: 디자인 시스템 06 빈 상태 규격(14/500 · 12 muted) — 다른 빈 상태(ListEmptyState)와 같은 상수를 쓴다(WP-1924).
          max-w-full·wrap-anywhere — 공백 없는 긴 채널 이름이 칸 밖으로 넘치지 않게 접는다(WP-1553):
          break-word 로는 플렉스 열 안 제목의 min-content 가 줄지 않아 넘친다.
          설명의 wrap-anywhere 는 공용 설명 클래스의 break-words 보다 뒤에 둬 tailwind-merge 가 이쪽을 남기게 한다(WP-2051). */}
      <div className={cn('max-w-full wrap-anywhere', emptyStateTitleClass)}>{title}</div>
      <p className={cn(emptyStateDescriptionClass, 'max-w-sm wrap-anywhere')}>{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
