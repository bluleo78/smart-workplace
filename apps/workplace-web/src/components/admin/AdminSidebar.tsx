// 관리 모듈 2차 사이드바 — 사용자/역할/감사로그/AGENT(비서 관리 흡수).
import { Bot, FileText, Shield, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { sidebarLinkClass } from '../layout/sidebar-link'

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
      className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40 p-3"
      data-testid="admin-sidebar"
    >
      <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        관리
      </div>
      <nav className="space-y-1">
        {ITEMS.map(({ label, href, icon: Icon }) => (
          <NavLink key={href} to={href} className={sidebarLinkClass}>
            <Icon className="h-4 w-4" /> {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
