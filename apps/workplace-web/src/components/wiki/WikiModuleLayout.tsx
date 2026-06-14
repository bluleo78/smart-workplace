import { Outlet } from 'react-router-dom'

import { WikiSidebar } from './WikiSidebar'

/** 위키 모듈 레이아웃 — 좌측 스페이스/페이지 트리 + Outlet(에디터/뷰). */
export function WikiModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <WikiSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
