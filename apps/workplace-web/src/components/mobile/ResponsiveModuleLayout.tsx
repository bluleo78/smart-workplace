// 모듈 레이아웃 목록↔상세 전환(WP-124).
// 데스크톱: 기존과 동일한 "사이드바 + Outlet" 가로 배치(DOM 불변).
// 모바일(list-detail): 모듈 루트면 사이드바를 전체폭 목록(탭 첫 화면)으로, 그 외 경로면 뒤로가기 바 + Outlet 만.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 폭(w-56→전체)·테두리·자체 제목 헤더를 정리한다
// (8개 사이드바 모두 <aside> 첫 자식이 sidebarTitleClass 제목 헤더라는 구조 규약에 기대어 숨김).
import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot, norm } from '@/lib/mobile/routes'
import { cn } from '@/lib/utils'

import { MobileBackBar } from './MobileBackBar'
import { MobileListHeader } from './MobileListHeader'
import { mobileSidebarListClass } from './sidebarListClass'

export function ResponsiveModuleLayout({
  sidebar,
  rootPath,
  title,
  scroll = 'auto',
}: {
  sidebar: ReactNode
  rootPath: string
  title: string
  /** 데스크톱 Outlet 래퍼 overflow — 모듈별 기존 값 보존(auto=overflow-y-auto, hidden=overflow-hidden, none=없음). */
  scroll?: 'auto' | 'hidden' | 'none'
}) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const outletClass = cn('min-w-0 flex-1', scroll === 'auto' && 'overflow-y-auto', scroll === 'hidden' && 'overflow-hidden')

  if (!isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-1">
        {sidebar}
        <div className={outletClass}>
          <Outlet />
        </div>
      </div>
    )
  }

  if (norm(pathname) === rootPath) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* 탭 루트(/chat 등)는 탭바가 보이므로 큰 제목 헤더. 탭 루트가 아닌 모듈 목록(/settings — 더보기에서 진입)은
            탭바가 숨으므로 막다른 길이 되지 않게 뒤로가기 바(→ /more, ✦ 포함)를 대신 둔다. */}
        {isTabRoot(rootPath) ? <MobileListHeader title={title} /> : <MobileBackBar title={title} />}
        <div data-testid="mobile-module-list" className={mobileSidebarListClass}>{sidebar}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <MobileBackBar title={title} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
