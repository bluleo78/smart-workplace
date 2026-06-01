// src/components/layout/AppRail.tsx
// 앱 런처 LNB — 명시적으로 모듈(앱)을 띄우는 레일. 기능 카탈로그가 아님.
// 모듈 내부 깊은 네비는 각 모듈의 2차 사이드바가 담당한다.
import {
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  Home,
  type LucideIcon,
  Menu,
  Shield,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

import { AppRailUserMenu } from './AppRailUserMenu'

interface RailItem {
  label: string
  href: string
  icon: LucideIcon
  // 활성 판별용 prefix. 없으면 href 로 판별한다.
  // (예: 관리 모듈은 href='/admin/users'(실제 라우트)지만 '/admin/*' 전체에서 활성)
  match?: string
}

// 활성화된 모듈 런처 항목
const MODULES: RailItem[] = [
  { label: '홈', href: '/', icon: Home },
  { label: '이슈', href: '/projects', icon: CircleDot },
]
// 어드민 전용 모듈
const ADMIN_MODULE: RailItem = { label: '관리', href: '/admin/users', icon: Shield, match: '/admin' }
// 예정 모듈 — 비활성 표시
const SOON = ['Chat', 'Wiki', 'Drive']

const STORAGE_KEY = 'app-rail-collapsed'

// 현재 경로가 해당 모듈에 속하는지 판별. 홈('/')은 정확히 일치할 때만 활성.
// 활성 판별 prefix 는 item.match 우선, 없으면 href. (관리 모듈이 /admin/* 전체에서 활성이 되도록)
function isActive(pathname: string, item: RailItem): boolean {
  const matchPath = item.match ?? item.href
  if (matchPath === '/') return pathname === '/'
  return pathname.startsWith(matchPath)
}

// 단일 레일 링크. collapsed 시 아이콘만 노출하고 라벨은 툴팁으로 보여준다.
function RailLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: RailItem
  active: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  const link = (
    <Link
      to={item.href}
      onClick={onNavigate}
      data-testid={`rail-link-${item.href}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center rounded-md text-[13px] font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground nav-active-indicator'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
        collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2',
      )}
    >
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  )
  if (collapsed) {
    // AppRail 은 아직 AppLayout 에 연결되지 않아(Task 5) 상위 TooltipProvider 가 없을 수 있다.
    // 자기완결적으로 동작하도록 collapsed 툴팁을 자체 Provider 로 감싼다.
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return link
}

// 앱 런처 레일. collapse 상태는 localStorage 에 영속, 모바일은 오버레이로 노출.
export function AppRail() {
  const location = useLocation()
  const { isAdmin } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev))
      return !prev
    })
  }
  const closeMobile = () => setMobileOpen(false)

  const items = isAdmin ? [...MODULES, ADMIN_MODULE] : MODULES

  return (
    <>
      {/* 모바일 햄버거 */}
      <button
        type="button"
        aria-label="메뉴 열기"
        data-testid="rail-mobile-toggle"
        className="fixed left-3 top-3 z-30 rounded-md border bg-background p-2 lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* 모바일 오버레이 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={closeMobile} />
      )}

      <aside
        data-testid="app-rail"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-sidebar transition-[width,transform] duration-200',
          'lg:static lg:translate-x-0',
          collapsed ? 'lg:w-[56px]' : 'lg:w-60',
          mobileOpen ? 'w-60 translate-x-0' : '-translate-x-full',
        )}
      >
        {/* 로고 + collapse 토글 */}
        <div className={cn('flex h-14 shrink-0 items-center border-b px-3', collapsed && 'justify-center px-0')}>
          {!collapsed && (
            <Link to="/" className="flex-1 truncate font-semibold" onClick={closeMobile}>
              Smart Workplace
            </Link>
          )}
          <button
            type="button"
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            data-testid="rail-collapse-toggle"
            className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 lg:block"
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* 모듈 런처 */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {items.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              active={isActive(location.pathname, item)}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          ))}

          {/* 예정 모듈 */}
          {!collapsed && (
            <div className="mt-4 space-y-1">
              {SOON.map((s) => (
                <div
                  key={s}
                  className="cursor-default rounded-md px-3 py-2 text-[13px] text-muted-foreground/50"
                  aria-disabled="true"
                >
                  {s} <span className="text-xs">(예정)</span>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* 하단 유저 메뉴 */}
        <div className="shrink-0 border-t p-2">
          <AppRailUserMenu collapsed={collapsed} />
        </div>
      </aside>
    </>
  )
}
