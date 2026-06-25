// 사이드바 내비 링크 1개. 현재 경로와 일치하면 active 스타일.
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { cn } from '../../lib/utils'

export function AdminNavItem({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={`admin-nav-${label}`}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  )
}
