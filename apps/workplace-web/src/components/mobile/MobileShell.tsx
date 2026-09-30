// 모바일 셸 — 본문 + 하단 탭바. 데스크톱 AppRail·AISidePanel·AIChip 을 대체한다.
// 100dvh 로 iOS 주소창 높이 변화를 따라가고, 탭 루트에서만 탭바를 보인다(상세는 전체 화면).
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { isTabRoot } from '@/lib/mobile/routes'

import { useMobileChrome } from './MobileChromeContext'
import { MobileTabBar } from './MobileTabBar'

/** 모바일 레이아웃 셸. overlay 는 본문 영역만 덮는 AI 풀스크린 등(탭바는 남는다). */
export function MobileShell({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  const showTabBar = isTabRoot(pathname) && !chrome?.tabBarHidden
  return (
    <div data-testid="mobile-shell" className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <main data-mobile-scroll-root className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        {children}
        {/* AIFullscreen(absolute inset-0) — 본문만 덮고 탭바는 남긴다. */}
        {overlay}
      </main>
      {showTabBar && <MobileTabBar />}
    </div>
  )
}
