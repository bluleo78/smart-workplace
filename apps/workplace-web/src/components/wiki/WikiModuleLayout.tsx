import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'
import { mobileWikiListClass } from '@/components/mobile/sidebarListClass'

import { WikiSidebar } from './WikiSidebar'

/**
 * 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰).
 * 모바일 목록 모드는 채팅 목록 규격에 머리말 여백·글자를 맞춘다(U3-R5, 데스크톱엔 쓰이지 않음).
 */
export function WikiModuleLayout() {
  return <ResponsiveModuleLayout sidebar={<WikiSidebar />} rootPath="/wiki" title="노트" listClassName={mobileWikiListClass} />
}
