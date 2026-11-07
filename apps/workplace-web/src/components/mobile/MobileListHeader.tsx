// 모바일 탭 루트 목록 상단 큰 제목(LargeTitle). 우측 끝에 전체 검색 🔍(MobileSearchButton, WP-1354)과 알림 벨(NotificationBell)을 둔다
// (hideBell: 알림 화면·탭 편집 등 벨이 없는 화면은 🔍 도 함께 숨긴다).
import type { ReactNode } from 'react'

import { mobileRootHeaderClass, mobileRootTitleClass } from './headerClass'
import { useHasMobileResourceErrorHeading } from './MobileResourceErrorHeadingContext'
import { MobileSearchButton } from './MobileSearchButton'
import { NotificationBell } from './NotificationBell'

export function MobileListHeader({ title, actions, hideBell = false }: { title: string; actions?: ReactNode; hideBell?: boolean }) {
  const hasErrorHeading = useHasMobileResourceErrorHeading()
  const Title = hasErrorHeading ? 'span' : 'h1'
  return (
    // 규격은 모바일 PageHeader(탭 루트)와 공유 — 홈·캘린더(PageHeader)와 채팅·작업(이 헤더)의 높이·제목·여백이 같아진다(U1-3).
    <div data-testid="mobile-list-header" className={mobileRootHeaderClass}>
      <Title className={mobileRootTitleClass}>{title}</Title>
      <div className="flex shrink-0 items-center gap-1">{actions}{!hideBell && <><MobileSearchButton /><NotificationBell /></>}</div>
    </div>
  )
}
