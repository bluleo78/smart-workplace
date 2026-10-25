// 모듈 레이아웃 목록↔상세 전환(WP-124).
// 데스크톱: "사이드바 + Outlet" 가로 배치. 사이드바는 폭 조절 틀(ResizableSidebar, WP-878)로 감싼다.
// 모바일(list-detail): 모듈 루트면 사이드바를 전체폭 목록(탭 첫 화면)으로, 그 외 경로면 뒤로가기 바 + Outlet 만.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 폭(w-56→전체)·테두리·자체 제목 헤더를 정리한다
// (8개 사이드바 모두 <aside> 첫 자식이 sidebarTitleClass 제목 헤더라는 구조 규약에 기대어 숨김).
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { ResizableSidebar } from '@/components/layout/ResizableSidebar'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isTabRoot, norm } from '@/lib/mobile/routes'
import { cn } from '@/lib/utils'

import { MobileBackBar } from './MobileBackBar'
import { MobileDetailCtx } from './MobileDetailContext'
import { MobileListHeader } from './MobileListHeader'
import { mobileSidebarListClass } from './sidebarListClass'

export function ResponsiveModuleLayout({
  sidebar,
  compactSidebar,
  widthKey,
  rootPath,
  title,
  scroll = 'auto',
  listClassName,
  listContext,
}: {
  sidebar: ReactNode
  /**
   * 데스크톱에서 sidebar 대신 그릴 접힌(아이콘 줄) 사이드바(WP-506). 폭이 고정이라 폭 조절 틀로 감싸지 않는다.
   * 언제 접을지(창 폭)는 부르는 쪽이 정해 그때만 넘긴다 — 접지 않는 모듈이 창 폭 변화를 구독하지 않게.
   */
  compactSidebar?: ReactNode
  /** 데스크톱 목록 폭을 기억하는 앱 이름(localStorage sidebar-width:<widthKey>, WP-878). */
  widthKey: string
  rootPath: string
  title: string
  /** 데스크톱 Outlet 래퍼 overflow — 모듈별 기존 값 보존(auto=overflow-y-auto, none=없음). */
  scroll?: 'auto' | 'none'
  /** 모바일 목록 모드 래퍼에 덧붙일 모듈 전용 클래스(설정 행 › 셰브런 등). 데스크톱엔 쓰이지 않는다. */
  listClassName?: string
  /**
   * WP-191: 모바일 목록 모드에서만 마운트할 화면 컨텍스트 등록기 요소(데스크톱은 같은 사이드바 옆 페이지가 각자 등록).
   * 데이터 훅을 등록기 안에 두어, 데스크톱·모바일 상세에선 쿼리 구독 자체가 일어나지 않게 한다.
   */
  listContext?: ReactNode
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
        {/* 데스크톱만 경계선을 끌어 목록 폭 조절 — 모바일 목록 래퍼는 [&>aside] 직계 선택자에 기대므로 감싸지 않는다.
            접힌 사이드바(compactSidebar)는 폭이 고정이라 틀 없이 그린다. */}
        {compactSidebar ?? <ResizableSidebar widthKey={widthKey}>{sidebar}</ResizableSidebar>}
        <div className={outletClass}>
          <Outlet />
        </div>
      </div>
    )
  }

  // 목록 = 모듈 루트 또는 경로 표가 탭 루트로 정한 하위 목록(노트 공간 /wiki/spaces/:id 처럼 2단 목록, WP-178).
  if (norm(pathname) === rootPath || isTabRoot(pathname)) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* 탭 루트(/chat 등)는 탭바가 보이므로 큰 제목 헤더. 탭 루트가 아닌 모듈 목록(/settings — 앱 목록에서 진입)은
            탭바가 숨으므로 막다른 길이 되지 않게 뒤로가기 바(→ /apps, ✦ 포함)를 대신 둔다. */}
        {isTabRoot(rootPath) ? <MobileListHeader title={title} /> : <MobileBackBar title={title} />}
        {listContext}
        <div data-testid="mobile-module-list" className={cn(mobileSidebarListClass, listClassName)}>{sidebar}</div>
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
