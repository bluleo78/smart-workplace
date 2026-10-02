import { useLocation } from 'react-router-dom'

import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileWikiListClass } from '@/components/mobile/sidebarListClass'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useWikiIndexRedirect } from '@/hooks/useWikiIndexRedirect'
import { norm } from '@/lib/mobile/routes'
import { MOBILE_TABS } from '@/lib/mobile/tabs'

import { WikiSidebar } from './WikiSidebar'

/**
 * 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰).
 * 모바일 목록 모드는 채팅 목록 규격에 머리말 여백·글자를 맞춘다(U3-R5, 데스크톱엔 쓰이지 않음).
 * 모바일(WP-178): /wiki/spaces/:id 도 목록(페이지 트리)이다(경로 표 isTabRoot). 사이드바는 공간을 URL 로만 알므로
 * 공간이 없는 /wiki 에선 데스크톱과 같은 규칙으로 고른 공간의 목록으로 보낸다
 * (데스크톱 WikiIndexRedirect 는 Outlet 에 있어 모바일 목록 모드에선 그려지지 않는다).
 */
export function WikiModuleLayout() {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  return (
    <>
      <ResponsiveModuleLayout sidebar={<WikiSidebar />} rootPath={MOBILE_TABS.wiki.path} title="노트" listClassName={mobileWikiListClass} />
      {isMobile && norm(pathname) === MOBILE_TABS.wiki.path && <MobileWikiIndexRedirect />}
    </>
  )
}

/** 모바일 /wiki 진입 시에만 마운트 — 마지막 본 페이지의 공간(없으면 첫 공간) 목록으로 이동. 그리는 것은 없다. */
function MobileWikiIndexRedirect() {
  useWikiIndexRedirect('space')
  return null
}
