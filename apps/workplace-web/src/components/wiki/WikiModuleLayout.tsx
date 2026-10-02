import { useLocation } from 'react-router-dom'

import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileWikiListClass } from '@/components/mobile/sidebarListClass'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useWikiIndexRedirect } from '@/hooks/useWikiIndexRedirect'
import { isWikiListPath, norm } from '@/lib/mobile/routes'

import { WikiSidebar } from './WikiSidebar'

/**
 * 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰).
 * 모바일 목록 모드는 채팅 목록 규격에 머리말 여백·글자를 맞춘다(U3-R5, 데스크톱엔 쓰이지 않음).
 * 모바일(WP-178): 노트는 "공간 → 페이지" 2단 목록이라 /wiki/spaces/:id 도 목록(페이지 트리)으로 그린다.
 * 사이드바는 공간을 URL 로만 알므로, 공간이 없는 /wiki 에선 데스크톱과 같은 규칙으로 고른 공간의 목록으로 보낸다
 * (데스크톱 WikiIndexRedirect 는 Outlet 에 있어 모바일 목록 모드에선 그려지지 않는다).
 */
export function WikiModuleLayout() {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  useWikiIndexRedirect({ enabled: isMobile && norm(pathname) === '/wiki', target: 'space' })
  return (
    <ResponsiveModuleLayout
      sidebar={<WikiSidebar />}
      rootPath="/wiki"
      title="노트"
      listClassName={mobileWikiListClass}
      isListPath={isWikiListPath}
    />
  )
}
