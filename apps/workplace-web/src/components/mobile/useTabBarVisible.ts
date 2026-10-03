// 지금 모바일 하단 탭바가 보이는가 — 탭 루트이고(알림은 고정됐을 때만) 페이지가 숨김을 요청하지 않았을 때.
// MobileShell(탭바 렌더 여부)과 AI 시트(탭바가 없으면 하단 안전영역을 시트가 비움)가 같은 판정을 쓴다.
import { useLocation } from 'react-router-dom'

import { isTabRoot } from '@/lib/mobile/routes'

import { useMobileChrome } from './MobileChromeContext'

export function useTabBarVisible(): boolean {
  const { pathname } = useLocation()
  const chrome = useMobileChrome()
  return isTabRoot(pathname, chrome?.slots) && !chrome?.tabBarHidden
}
