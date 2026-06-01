// 관리 모듈 2차 사이드바 — 사용자/역할/감사로그/AGENT(비서 관리 흡수).
import { Bot, FileText, Shield, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

// 관리 모듈 내비게이션 항목. AGENT 는 기존 GNB 의 비서 관리 메뉴를 흡수한 것.
const ITEMS = [
  { label: '사용자', href: '/admin/users', icon: Users },
  { label: '역할', href: '/admin/roles', icon: Shield },
  { label: '감사 로그', href: '/admin/audit-logs', icon: FileText },
  { label: 'AGENT', href: '/admin/agents', icon: Bot },
]

// NavLink active 상태에 따라 강조 스타일을 토글한다.
const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent/50',
  )

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
          <NavLink key={href} to={href} className={linkClass}>
            <Icon className="h-4 w-4" /> {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
