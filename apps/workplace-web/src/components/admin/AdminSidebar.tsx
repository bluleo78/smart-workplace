// 관리 모듈 2차 사이드바 — 사용자/역할/감사로그/AGENT(비서 관리 흡수).
import { Bot, FileText, Settings, Shield, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass, sidebarTitleClass } from '@/components/layout/sidebar-link'

// 관리 모듈 내비게이션 항목. AGENT 는 기존 GNB 의 비서 관리 메뉴를 흡수한 것.
const ITEMS = [
  { label: '사용자', href: '/admin/users', icon: Users },
  { label: '역할', href: '/admin/roles', icon: Shield },
  { label: '감사 로그', href: '/admin/audit-logs', icon: FileText },
  { label: 'AGENT', href: '/admin/agents', icon: Bot },
]

export function AdminSidebar() {
  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40"
      data-testid="admin-sidebar"
    >
      {/* 앱 타이틀 헤더 — 레일과 동일한 앱 아이콘 + 이름으로 "설정" 앱임을 명시(Slack 모델) */}
      <div className={sidebarTitleClass}>
        <Settings className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        설정
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <nav className="space-y-1">
          {ITEMS.map(({ label, href, icon: Icon }) => (
            <NavLink key={href} to={href} className={sidebarLinkClass}>
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  )
}
