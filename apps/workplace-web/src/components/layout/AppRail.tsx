// src/components/layout/AppRail.tsx
// 앱 런처 LNB — 명시적으로 모듈(앱)을 띄우는 레일. 기능 카탈로그가 아님.
// 정체성: Slack 워크스페이스 레일 / macOS 독처럼 "항상 아이콘 레일"(확장 모드 없음).
// 모듈 내부의 텍스트 맥락(라벨/깊은 네비)은 각 모듈의 2차 사이드바가 책임진다.
// 데스크톱(lg) = 56px 아이콘 레일(라벨은 Tooltip), 모바일 = 오버레이 드로어(아이콘+라벨).
import {
  BookOpen,
  Boxes,
  HardDrive,
  Home,
  LayoutList,
  type LucideIcon,
  Menu,
  MessageSquare,
  Settings,
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
  // 활성 판별용 prefix(들). 없으면 href 로 판별한다.
  // (예: 관리 모듈은 href='/admin/users'(실제 라우트)지만 '/admin/*' 전체에서 활성,
  //  이슈 모듈은 '/projects' 와 '/me'(내 태스크) 양쪽에서 활성)
  match?: string | string[]
}

// 활성화된 모듈 런처 항목
const MODULES: RailItem[] = [
  { label: '홈', href: '/', icon: Home },
  { label: '작업 관리', href: '/projects', icon: LayoutList, match: ['/projects', '/me'] },
  { label: 'Chat', href: '/chat', icon: MessageSquare },
]
// 어드민 전용 모듈 — "설정"(워크스페이스 설정·관리)
const ADMIN_MODULE: RailItem = { label: '설정', href: '/admin/users', icon: Settings, match: '/admin' }
// 예정 모듈 — 비활성(흐림). 아이콘 레일이므로 아이콘으로 표시한다.
const SOON: { label: string; icon: LucideIcon }[] = [
  { label: 'Wiki', icon: BookOpen },
  { label: 'Drive', icon: HardDrive },
]

// 현재 경로가 해당 모듈에 속하는지 판별. 홈('/')은 정확히 일치할 때만 활성.
// 활성 판별 prefix 는 item.match(문자열/배열) 우선, 없으면 href.
// (관리 모듈이 /admin/* 전체에서, 이슈 모듈이 /projects·/me 전체에서 활성이 되도록)
function isActive(pathname: string, item: RailItem): boolean {
  const matchPaths = item.match
    ? Array.isArray(item.match)
      ? item.match
      : [item.match]
    : [item.href]
  return matchPaths.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)))
}

// 단일 레일 링크. 데스크톱(lg)은 아이콘만 + 라벨 Tooltip, 모바일 드로어는 아이콘+라벨.
function RailLink({
  item,
  active,
  onNavigate,
}: {
  item: RailItem
  active: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={item.href}
          onClick={onNavigate}
          data-testid={`rail-link-${item.href}`}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
            'lg:justify-center lg:gap-0 lg:px-2 lg:py-2.5',
            active
              ? 'bg-accent text-accent-foreground nav-active-indicator'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
          )}
        >
          <Icon className="h-5 w-5 shrink-0" />
          {/* 모바일 드로어에서만 라벨 노출. 데스크톱(lg)은 Tooltip 으로 대체. */}
          <span className="lg:hidden">{item.label}</span>
        </Link>
      </TooltipTrigger>
      {/* 데스크톱 아이콘 레일에서 hover 시 라벨 노출 */}
      <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

// 앱 런처 레일. 데스크톱은 상주 아이콘 레일, 모바일은 오버레이 드로어.
export function AppRail() {
  const location = useLocation()
  const { isAdmin } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const closeMobile = () => setMobileOpen(false)

  // 모바일 오버레이가 열려 있을 때 Escape 로 닫을 수 있게 한다(키보드 접근성).
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  const items = isAdmin ? [...MODULES, ADMIN_MODULE] : MODULES

  return (
    <TooltipProvider>
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
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-sidebar transition-transform duration-200',
          'lg:static lg:w-[56px] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* 앱 마크 — 클릭 시 홈. 데스크톱은 마크만, 모바일은 마크+워드마크. */}
        <div className="flex h-14 shrink-0 items-center border-b px-3 lg:justify-center lg:px-0">
          <Link
            to="/"
            data-testid="rail-home"
            aria-label="홈"
            onClick={closeMobile}
            className="flex items-center gap-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Boxes className="h-5 w-5" />
            </span>
            <span className="truncate font-semibold lg:hidden">Smart Workplace</span>
          </Link>
        </div>

        {/* 모듈 런처 */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {items.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              active={isActive(location.pathname, item)}
              onNavigate={closeMobile}
            />
          ))}

          {/* 예정 모듈 — 흐림/비활성, 클릭 불가 */}
          <div className="mt-4 space-y-1">
            {SOON.map((s) => {
              const Icon = s.icon
              return (
                <Tooltip key={s.label}>
                  <TooltipTrigger asChild>
                    <div
                      aria-disabled="true"
                      className={cn(
                        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted-foreground/50',
                        'lg:justify-center lg:gap-0 lg:px-2 lg:py-2.5',
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="lg:hidden">
                        {s.label} <span className="text-xs">(예정)</span>
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
                    {s.label} (예정)
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </nav>

        {/* 하단 유저 메뉴 */}
        <div className="shrink-0 border-t p-2">
          <AppRailUserMenu />
        </div>
      </aside>
    </TooltipProvider>
  )
}
