// 모바일 탭 루트 목록 상단 큰 제목(LargeTitle). 우측 끝에 알림 벨(NotificationBell)을 둔다(hideBell: 알림 화면·탭 편집 등에서 숨김).
import type { ReactNode } from 'react'

import { NotificationBell } from './NotificationBell'

export function MobileListHeader({ title, actions, hideBell = false }: { title: string; actions?: ReactNode; hideBell?: boolean }) {
  return (
    <div data-testid="mobile-list-header" className="flex h-14 shrink-0 items-center justify-between px-4">
      <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
      <div className="flex items-center gap-1">{actions}{!hideBell && <NotificationBell />}</div>
    </div>
  )
}
