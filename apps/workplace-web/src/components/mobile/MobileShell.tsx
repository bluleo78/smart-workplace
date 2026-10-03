// 모바일 셸 — 본문 + 하단 탭바. 데스크톱 AppRail·AISidePanel·AIChip 을 대체한다.
// 100dvh 로 iOS 주소창 높이 변화를 따라가고(키보드가 열리면 --vvh), 탭 루트에서만 탭바를 보인다(상세는 전체 화면).
import { type ReactNode, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useInboxPanel } from '@/components/layout/InboxContext'
import { cn } from '@/lib/utils'

import { MobileTabBar } from './MobileTabBar'
import { useTabBarVisible } from './useTabBarVisible'
import { useVisualViewport } from './useVisualViewport'

/** 모바일 레이아웃 셸. overlay 는 셸 루트(본문+탭바)를 덮는 AI 시트 레이어. */
export function MobileShell({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const { pathname } = useLocation()
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
  // 알림(/notifications)은 사용자가 탭바에 고정했을 때만 탭 루트 — 판정은 AI 시트(하단 안전영역 여백)와 공유(U1-5·U2-3).
  const showTabBar = useTabBarVisible()
  // 키보드가 열리면 :root 에 보이는 높이(--vvh)를 공개 — 셸이 그 높이로 줄어 iOS 의 페이지 밀어 올림을 막는다(헤더 고정·입력창은 키보드 바로 위).
  useVisualViewport()
  // viewport-fit=cover(index.html)라 가로 모드에선 노치가 좌우 본문을 가린다 — 셸 좌우를 안전영역만큼 비운다.
  return (
    <div
      data-testid="mobile-shell"
      // 키보드가 열리면 셸을 보이는 영역(visualViewport) 위치에 고정한다 — iOS 는 문서를 스크롤하지 않고 보이는 영역 자체를
      // 레이아웃 뷰포트 아래로 옮기기도 해(offsetTop>0, scrollY=0) scrollTo 로는 되돌릴 수 없다. 실기기에서 kb=true 인데도 밀림(WP-154).
      className="relative flex h-[var(--vvh,100dvh)] flex-col overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-foreground [:root[data-keyboard-open]_&]:fixed [:root[data-keyboard-open]_&]:inset-x-0 [:root[data-keyboard-open]_&]:top-[var(--vv-top)]">
      {/* 탭바가 숨은 화면(상세·작성기)은 탭바의 하단 안전영역 여백이 사라지므로 본문이 직접 홈 인디케이터 영역을 비운다(U1-6). */}
      <main
        data-mobile-scroll-root
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-[env(safe-area-inset-top)]',
          // 키보드가 열려 있으면 홈 인디케이터는 키보드 아래라 여백이 필요 없다 — 입력창과 키보드 사이 빈칸을 없앤다.
          !showTabBar && 'pb-[env(safe-area-inset-bottom)] [:root[data-keyboard-open]_&]:pb-0',
        )}
      >
        {children}
      </main>
      {showTabBar && <MobileTabBar />}
      {/* WP-191: AI 시트 — 본문과 탭바를 함께 덮는 셸 루트 레이어(키보드가 열리면 탭바 위까지 덮는다). */}
      {overlay}
    </div>
  )
}
