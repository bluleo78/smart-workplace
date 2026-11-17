// 모바일 탭 루트 목록 상단 큰 제목(LargeTitle). 우측 끝에 전체 검색 🔍(MobileSearchButton, WP-1354)·도움말 「?」(MobileHelpButton, WP-1505)·
// 알림 벨(NotificationBell)을 이 순서로 둔다(hideBell: 알림 화면·탭 편집 등 벨이 없는 화면은 🔍·「?」도 함께 숨긴다).
import type { ReactNode } from 'react'

import { mobileRootHeaderClass, mobileRootTitleClass } from './headerClass'
import { MobileHelpButton } from './MobileHelpButton'
import { useHasMobileResourceErrorHeading } from './MobileResourceErrorHeadingContext'
import { MobileSearchButton } from './MobileSearchButton'
import { NotificationBell } from './NotificationBell'

export function MobileListHeader({
  title,
  titleAccessory,
  actions,
  hideBell = false,
}: {
  title: string
  /** 제목 바로 뒤에 붙는 전환 탭 등(알림 화면의 「알림|보관함」, WP-1690). 없으면 제목만 늘어난다. */
  titleAccessory?: ReactNode
  actions?: ReactNode
  hideBell?: boolean
}) {
  const hasErrorHeading = useHasMobileResourceErrorHeading()
  const Title = hasErrorHeading ? 'span' : 'h1'
  return (
    // 규격은 모바일 PageHeader(탭 루트)와 공유 — 홈·캘린더(PageHeader)와 채팅·작업(이 헤더)의 높이·제목·여백이 같아진다(U1-3).
    <div data-testid="mobile-list-header" className={mobileRootHeaderClass}>
      {titleAccessory == null ? (
        <Title className={mobileRootTitleClass}>{title}</Title>
      ) : (
        // 제목이 먼저 말줄임되고 전환 탭은 제목 바로 뒤에 남는다.
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Title className={`${mobileRootTitleClass} flex-initial`}>{title}</Title>
          {titleAccessory}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">{actions}{!hideBell && <><MobileSearchButton /><MobileHelpButton /><NotificationBell /></>}</div>
    </div>
  )
}
