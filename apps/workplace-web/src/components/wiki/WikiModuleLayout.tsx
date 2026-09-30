import { ResponsiveModuleLayout } from '@/components/mobile/ResponsiveModuleLayout'

import { WikiSidebar } from './WikiSidebar'

/** 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰). */
export function WikiModuleLayout() {
  return <ResponsiveModuleLayout sidebar={<WikiSidebar />} rootPath="/wiki" title="노트" />
}
