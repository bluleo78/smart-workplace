// 모듈 레이아웃 목록↔상세 전환(WP-124).
// 데스크톱: 기존과 동일한 "사이드바 + Outlet" 가로 배치(DOM 불변).
// 모바일(list-detail): 모듈 루트면 사이드바를 전체폭 목록(탭 첫 화면)으로, 그 외 경로면 뒤로가기 바 + Outlet 만.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 폭(w-56→전체)·테두리·자체 제목 헤더를 정리한다
// (8개 사이드바 모두 <aside> 첫 자식이 sidebarTitleClass 제목 헤더라는 구조 규약에 기대어 숨김).
import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

import { MobileBackBar } from './MobileBackBar'
import { MobileListHeader } from './MobileListHeader'

// 끝 슬래시를 제거해 '/chat/' 와 '/chat' 을 같은 루트로 취급한다.
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

// 모바일 목록 모드에서 사이드바를 전체폭 목록처럼 보이게 하는 래퍼 클래스.
const mobileSidebarListClass = cn(
  'min-h-0 flex-1 overflow-y-auto',
  '[&>aside]:w-full [&>aside]:border-r-0 [&>aside]:bg-background',
  '[&>aside>:first-child]:hidden',
  // 터치 영역 최소 44px(모바일 관례)
  '[&_a]:min-h-11 [&_button]:min-h-11',
)

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
        <MobileListHeader title={title} />
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
