// 대화 빈 상태 — 메시지 0건일 때 "대화의 시작" 안내. 아이콘+제목+설명(+선택 액션).
import type { ReactNode } from 'react'

import { bodySectionTitleClass } from '@/components/layout/sidebar-link'
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
      {/* 제목: 본문 섹션 제목 위계(14/20/600) — 손으로 만든 빈 상태(드라이브 「최근」 등)와 같은 크기로 섞이지 않고,
          헤더 바 페이지 제목 h1(15px/700) 아래 위계도 지킨다(WP-1881).
          max-w-full·wrap-anywhere — 공백 없는 긴 채널 이름이 칸 밖으로 넘치지 않게 접는다(WP-1553):
          break-word 로는 플렉스 열 안 제목의 min-content 가 줄지 않아 넘친다. */}
      <div className={cn('max-w-full wrap-anywhere', bodySectionTitleClass)}>{title}</div>
      <p className="max-w-sm text-sm text-muted-foreground wrap-anywhere">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
