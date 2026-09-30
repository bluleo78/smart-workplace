// 모듈 레이아웃 목록↔상세 전환(WP-124).
// 데스크톱: 기존과 동일한 "사이드바 + Outlet" 가로 배치(DOM 불변).
// 모바일(list-detail): 모듈 루트면 사이드바를 전체폭 목록(탭 첫 화면)으로, 그 외 경로면 뒤로가기 바 + Outlet 만.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 폭(w-56→전체)·테두리·자체 제목 헤더를 정리한다
// (8개 사이드바 모두 <aside> 첫 자식이 sidebarTitleClass 제목 헤더라는 구조 규약에 기대어 숨김).
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot, norm } from '@/lib/mobile/routes'
import { cn } from '@/lib/utils'

import { MobileBackBar } from './MobileBackBar'
import { MobileDetailCtx } from './MobileDetailContext'
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
  /** 데스크톱 Outlet 래퍼 overflow — 모듈별 기존 값 보존(auto=overflow-y-auto, none=없음). */
  scroll?: 'auto' | 'none'
}) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const outletClass = cn('min-w-0 flex-1', scroll === 'auto' && 'overflow-y-auto')
  // 상세 분기: 페이지 헤더 등록 수 — 1 이상이면 페이지 헤더가 ‹·✦ 를 품으므로 뒤로가기 바를 그리지 않는다(헤더는 하나, U1-1).
  // 훅 규칙상 분기 전에 선언한다(데스크톱·목록 분기에선 쓰이지 않음).
  const [headerCount, setHeaderCount] = useState(0)
  const register = useCallback(() => {
    setHeaderCount((n) => n + 1)
    return () => setHeaderCount((n) => n - 1)
  }, [])
  const detailCtx = useMemo(() => ({ title, register }), [title, register])

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
        {/* 탭 루트(/chat 등)는 탭바가 보이므로 큰 제목 헤더. 탭 루트가 아닌 모듈 목록(/settings — 앱 목록에서 진입)은
            탭바가 숨으므로 막다른 길이 되지 않게 뒤로가기 바(→ /apps, ✦ 포함)를 대신 둔다. */}
        {isTabRoot(rootPath) ? <MobileListHeader title={title} /> : <MobileBackBar title={title} />}
        <div data-testid="mobile-module-list" className={mobileSidebarListClass}>{sidebar}</div>
      </div>
    )
  }

  return (
    <MobileDetailCtx.Provider value={detailCtx}>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {headerCount === 0 && <MobileBackBar title={title} />}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </MobileDetailCtx.Provider>
  )
}
