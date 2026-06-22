// src/components/layout/AppRail.tsx
// 앱 런처 LNB — 명시적으로 모듈(앱)을 띄우는 레일. 기능 카탈로그가 아님.
// 정체성: Slack 워크스페이스 레일 / macOS 독처럼 "항상 아이콘 레일"(확장 모드 없음).
// 모듈 내부의 텍스트 맥락(라벨/깊은 네비)은 각 모듈의 2차 사이드바가 책임진다.
// 데스크톱(lg) = 56px 아이콘 레일(라벨은 Tooltip), 모바일 = 오버레이 드로어(아이콘+라벨).
import {
  BookOpen,
  CalendarDays,
  HardDrive,
  Home,
  LayoutList,
  type LucideIcon,
  Mail,
  Menu,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { AppRailUserMenu } from './AppRailUserMenu'
import { InboxPanel } from './InboxPanel'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

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
  // 소통 묶음 — 대화·메일·연락처를 인접 배치, 파일(드라이브)은 끝으로.
  { label: '대화', href: '/chat', icon: MessageSquare },
  { label: '메일', href: '/mail', icon: Mail },
  { label: '연락처', href: '/contacts', icon: Users },
  { label: '캘린더', href: '/calendar', icon: CalendarDays },
  { label: '드라이브', href: '/drive', icon: HardDrive },
  { label: '노트', href: '/wiki', icon: BookOpen },
  { label: '설정', href: '/settings/profile', icon: Settings, match: ['/settings', '/admin'] },
]
// 예정 모듈 — 현재 없음(노트 활성화로 비활성 앱 소진).
const SOON: { label: string; icon: LucideIcon }[] = []

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
          // 데스크톱(lg)에선 라벨 span 이 lg:hidden 이라 accessible name 이 사라진다.
          // 모든 뷰포트에서 SR/음성제어용 이름을 보장하기 위해 항상 aria-label 부여(Tooltip 은 시각 보조).
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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
  const [mobileOpen, setMobileOpen] = useState(false)
  // AI 어시스턴트 표시 모드 — 앱 전환 시 풀스크린을 side 로 강등(#454).
  const { mode, open: openAssistant } = useAssistant()

  // 모바일 드로어 닫기(백드롭/Escape 용) — AI 모드는 건드리지 않는다.
  const closeMobile = () => setMobileOpen(false)

  // 레일에서 앱으로 네비게이션할 때 공통 처리:
  // - 모바일 드로어 닫기
  // - AI 가 풀스크린이면 side 패널로 강등(#454) — 풀스크린이 콘텐츠를 덮어 전환된 앱이
  //   가려지므로, 새 앱 화면과 AI 가 함께 보이도록 내린다. side/closed 면 그대로 둔다.
  const onNavigate = () => {
    setMobileOpen(false)
    if (mode === 'fullscreen') openAssistant('side')
  }

  // 모바일 오버레이가 열려 있을 때 Escape 로 닫을 수 있게 한다(키보드 접근성).
  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  const items = MODULES

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
        {/* 상단 — 워크스페이스 스위처(활성 테넌트 없으면 미렌더). */}
        <div className="flex h-14 shrink-0 items-center border-b px-2 lg:px-1">
          <WorkspaceSwitcher />
        </div>

        {/* 모듈 런처 */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {items.map((item) => (
            <RailLink
              key={item.href}
              item={item}
              active={isActive(location.pathname, item)}
              onNavigate={onNavigate}
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
                        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50',
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

        {/* 하단: 알림 인박스 + 유저 메뉴 */}
        <div className="shrink-0 space-y-1 border-t p-2">
          <InboxPanel />
          <AppRailUserMenu />
        </div>
      </aside>
    </TooltipProvider>
  )
}
