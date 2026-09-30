// 지금 모바일 하단 탭바가 보이는가 — 탭 루트이고(알림은 고정됐을 때만) 페이지가 숨김을 요청하지 않았을 때.
// MobileShell(탭바 렌더 여부)과 AI 풀스크린(탭바가 있으면 탭 전환이 곧 닫기라 × 생략)이 같은 판정을 쓴다.
import { useLocation } from 'react-router-dom'

import { isTabRoot } from '@/lib/mobile/routes'

import { useMobileChrome } from './MobileChromeContext'

export function useTabBarVisible(): boolean {
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  return isTabRoot(pathname, chrome?.slots) && !chrome?.tabBarHidden
}
