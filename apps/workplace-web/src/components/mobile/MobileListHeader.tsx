// 모바일 탭 루트 목록 상단 큰 제목(LargeTitle). 우측 끝에 알림 벨(NotificationBell)을 둔다(hideBell: 알림 화면·탭 편집 등에서 숨김).
import type { ReactNode } from 'react'

import { mobileRootHeaderClass, mobileRootTitleClass } from './headerClass'
import { NotificationBell } from './NotificationBell'

export function MobileListHeader({ title, actions, hideBell = false }: { title: string; actions?: ReactNode; hideBell?: boolean }) {
  return (
    // 규격은 모바일 PageHeader(탭 루트)와 공유 — 홈·캘린더(PageHeader)와 채팅·작업(이 헤더)의 높이·제목·여백이 같아진다(U1-3).
    <div data-testid="mobile-list-header" className={mobileRootHeaderClass}>
      <h1 className={mobileRootTitleClass}>{title}</h1>
      <div className="flex shrink-0 items-center gap-1">{actions}{!hideBell && <NotificationBell />}</div>
    </div>
  )
}
