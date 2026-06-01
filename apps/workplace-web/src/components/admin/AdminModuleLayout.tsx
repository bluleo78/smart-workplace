// 관리 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { Outlet } from 'react-router-dom'

import { AdminSidebar } from './AdminSidebar'

export function AdminModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
