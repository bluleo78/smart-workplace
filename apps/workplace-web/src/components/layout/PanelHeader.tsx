// src/components/layout/PanelHeader.tsx
// 앱 공통 패널(AI 옆 패널) 헤더 — 페이지 헤더와 같은 56px·하단선으로 한 선 정렬.
// 본문 안 보조 칸(스레드 등)은 이것 대신 subPaneHeaderClass 를 쓴다(페이지 헤더 아래에 놓이므로).
import type { ReactNode } from 'react'

import { pageGutterClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

/**
 * 앱 공통 패널 헤더(AI 옆 패널 등) — 제목 + 오른쪽 액션 한 줄.
 * 페이지 헤더(Page.Header)와 같은 56px(h-14)·하단선이라 나란히 놓여도 한 선으로 정렬된다.
 * 페이지 본문 안 보조 칸(스레드 등)은 페이지 헤더 아래에 놓이므로 이것 대신 subPaneHeaderClass 를 쓴다.
 */
export function PanelHeader({ title, actions, className, 'data-testid': testId }: {
  title: ReactNode; actions?: ReactNode; className?: string; 'data-testid'?: string
}) {
  return (
    <div data-testid={testId} className={cn('flex h-14 shrink-0 items-center justify-between gap-2 border-b', pageGutterClass, className)}>
      <div className="flex min-w-0 items-center gap-2">{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
