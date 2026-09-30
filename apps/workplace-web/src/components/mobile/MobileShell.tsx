// 모바일 셸 — 본문 + 하단 탭바. 데스크톱 AppRail·AISidePanel·AIChip 을 대체한다.
// 100dvh 로 iOS 주소창 높이 변화를 따라가고, 탭 루트에서만 탭바를 보인다(상세는 전체 화면).
import { type ReactNode, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { isTabRoot } from '@/lib/mobile/routes'

import { useMobileChrome } from './MobileChromeContext'
import { MobileTabBar } from './MobileTabBar'

/** 모바일 레이아웃 셸. overlay 는 본문 영역만 덮는 AI 풀스크린 등(탭바는 남는다). */
export function MobileShell({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  const { open: inboxOpen, setOpen: setInboxOpen } = useInboxPanel()
  const navigate = useNavigate()
  // 모바일엔 레일 Popover 가 없으므로, 외부에서 인박스를 열면(홈 '멘션' 셀 등) 알림 화면으로 보낸다.
  useEffect(() => {
    if (!inboxOpen) return
    setInboxOpen(false)
    // 이미 알림 화면이면 replace 로 이동해 중복 히스토리 항목이 쌓이지 않게 한다.
    navigate('/notifications', { replace: pathname === '/notifications' })
  }, [inboxOpen, setInboxOpen, navigate, pathname])
  const showTabBar = isTabRoot(pathname) && !chrome?.tabBarHidden
  // 실제 탭바 높이(안전영역 포함)를 CSS 변수로 공개한다 — 메일 작성 도크 등 fixed 부품이 탭바 위로 뜨게 하되,
  // 탭바가 숨은 화면에선 0 이 되어 화면 하단에 붙는다. 고정 px 를 복제하지 않도록 렌더된 높이를 관측한다.
  useEffect(() => {
    const root = document.documentElement
    const bar = showTabBar ? document.querySelector<HTMLElement>('[data-testid="mobile-tabbar"]') : null
    if (!bar) {
      root.style.setProperty('--mobile-tabbar-h', '0px')
      return () => root.style.removeProperty('--mobile-tabbar-h')
    }
    const sync = () => root.style.setProperty('--mobile-tabbar-h', `${bar.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bar)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--mobile-tabbar-h')
    }
  }, [showTabBar])
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
