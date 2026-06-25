// 운영자 콘솔 좌측 LNB. 상단 브랜드 + 운영 메뉴 항목 + 하단 프로필 메뉴.
// 고객 콘솔과 동일 디자인 토큰. 워크스페이스 스위처는 없음(운영자는 전 테넌트를 가로질러 일함).
import { BookOpen, LayoutDashboard, Settings, ShieldCheck, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { AdminNavItem } from './AdminNavItem'
import { AdminUserMenu } from './AdminUserMenu'

export function AdminSidebar() {
  return (
    <aside className="flex h-screen w-[200px] shrink-0 flex-col border-r bg-card">
      {/* 상단: 브랜드 */}
      <Link
        to="/"
        data-testid="admin-home"
        className="flex h-14 items-center px-4 font-semibold"
      >
        플랫폼 콘솔
      </Link>
      {/* 운영 메뉴 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        <AdminNavItem to="/dashboard" icon={LayoutDashboard} label="대시보드" />
        <AdminNavItem to="/" icon={Users} label="테넌트" end />
        <AdminNavItem to="/operators" icon={ShieldCheck} label="운영자" />
        <p className="px-3 pb-1 pt-3 text-xs uppercase tracking-wide text-muted-foreground">
          시스템
        </p>
        <AdminNavItem to="/audit" icon={BookOpen} label="감사 로그" />
        <AdminNavItem to="/settings" icon={Settings} label="설정" />
      </nav>
      {/* 하단: 프로필 메뉴 */}
      <div className="border-t p-2">
        <AdminUserMenu />
      </div>
    </aside>
  )
}
