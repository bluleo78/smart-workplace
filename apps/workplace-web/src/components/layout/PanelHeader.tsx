// src/components/layout/PanelHeader.tsx
// 앱 공통 패널(AI 옆 패널) 헤더 — 페이지 헤더와 같은 56px·하단선으로 한 선 정렬.
// 본문 안 보조 칸(스레드 등)은 이것 대신 subPaneHeaderClass 를 쓴다(페이지 헤더 아래에 놓이므로).
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function PanelHeader({ title, actions, className, ...rest }: {
  title: ReactNode; actions?: ReactNode; className?: string; 'data-testid'?: string
}) {
  return (
    <div data-testid={rest['data-testid']} className={cn('flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4', className)}>
      <div className="flex min-w-0 items-center gap-2">{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
