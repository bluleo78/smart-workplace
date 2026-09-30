// 모바일 탭 루트 목록 상단 큰 제목(LargeTitle). 우측 끝에 알림 벨(NotificationBell)을 항상 둔다.
import type { ReactNode } from 'react'

import { NotificationBell } from './NotificationBell'

export function MobileListHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div data-testid="mobile-list-header" className="flex h-14 shrink-0 items-center justify-between px-4">
      <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
      <div className="flex items-center gap-1">{actions}<NotificationBell /></div>
    </div>
  )
}
