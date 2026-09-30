// 모바일 셸 — 본문 + 하단 탭바. 데스크톱 AppRail·AISidePanel·AIChip 을 대체한다.
// 100dvh 로 iOS 주소창 높이 변화를 따라가고, 탭 루트에서만 탭바를 보인다(상세는 전체 화면).
import { type ReactNode, useEffect, useRef } from 'react'
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
  // 셸이 마운트될 때 이미 열려 있던 인박스 = 데스크톱에서 연 레일 Popover 가 lg 경계를 넘어온 것.
  // 사용자가 모바일에서 요청한 게 아니므로 닫기만 하고 알림 화면으로 끌고 가지 않는다.
  // (첫 실행 플래그 대신 마운트 시 값을 쓰는 이유: StrictMode 이펙트 재실행에서도 판정이 바뀌지 않게.)
  const openedBeforeMount = useRef(inboxOpen)
  // 모바일엔 레일 Popover 가 없으므로, 외부에서 인박스를 열면(홈 '멘션' 셀 등) 알림 화면으로 보낸다.
  useEffect(() => {
    if (!inboxOpen) {
      openedBeforeMount.current = false
      return
    }
    setInboxOpen(false)
    if (openedBeforeMount.current) return
    // 이미 알림 화면이면 replace 로 이동해 중복 히스토리 항목이 쌓이지 않게 한다.
    navigate('/notifications', { replace: pathname === '/notifications' })
  }, [inboxOpen, setInboxOpen, navigate, pathname])
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
