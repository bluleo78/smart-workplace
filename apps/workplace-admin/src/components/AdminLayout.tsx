import { Outlet } from 'react-router-dom'

import { AdminSidebar } from './layout/AdminSidebar'

// 운영자 콘솔 공통 레이아웃.
// - 좌측 LNB 사이드바(브랜드 + 운영 메뉴 + 하단 프로필) + 본문 <Outlet/>.
// - 고객 콘솔(AppRail + 하단 프로필) 패턴과 일관.
export function AdminLayout() {
  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
