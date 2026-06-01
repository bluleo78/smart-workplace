# LNB/GNB 레이아웃 재정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상단 GNB를 제거하고 좌측 "앱 런처 LNB + 모듈 2차 사이드바" 구조로 전환하며, AI 챗 도크를 전역 상주시킨다.

**Architecture:** fire-hub `AppLayout`의 사이드바 패턴(collapse+localStorage, 활성표시, 모바일 오버레이)을 `AppRail`로 이식. 홈 세션 상태(`useHomeSession`)를 `AppLayout` 레벨의 Context로 끌어올려 챗 도크는 전역, 캔버스는 홈 전용으로 분리. 이슈/관리 모듈은 각자 2차 사이드바를 가진 중첩 라우트 레이아웃으로 감싼다.

**Tech Stack:** React 19, react-router, TanStack Query, Tailwind 4, shadcn/ui, lucide-react, next-themes, Playwright.

---

## 파일 구조

신규:
- `src/components/layout/AppRail.tsx` — 앱 런처 LNB (collapse/localStorage/활성/모바일오버레이/유저메뉴)
- `src/components/layout/AppRailUserMenu.tsx` — 레일 하단 유저 드롭다운(프로필/테마/로그아웃)
- `src/hooks/HomeSessionContext.tsx` — `useHomeSession`을 감싸 전역 제공하는 Context + Provider + `useHomeSessionContext`
- `src/components/layout/GlobalChatDock.tsx` — 전역 챗 도크(기존 `FloatingChat` 래퍼, Context 소비)
- `src/components/issue/IssueModuleLayout.tsx` — 이슈 라우트 레이아웃(2차 사이드바 + `<Outlet/>`)
- `src/components/issue/IssueSidebar.tsx` — 이슈 2차 사이드바(내 태스크 + 프로젝트 목록 + 새 프로젝트)
- `src/components/admin/AdminModuleLayout.tsx` — 관리 라우트 레이아웃(2차 사이드바 + `<Outlet/>`)
- `src/components/admin/AdminSidebar.tsx` — 관리 2차 사이드바(사용자/역할/감사로그/AGENT)

변경:
- `src/components/layout/AppLayout.tsx` — GNB 헤더 제거, flex 셸로 전환, `HomeSessionProvider` + `AppRail` + `<Outlet/>` + `GlobalChatDock`
- `src/components/home/HomeShell.tsx` — `ModuleSidebar`/`FloatingChat` 제거, Context에서 세션 소비, GNB 높이 차감 제거
- `src/App.tsx` — 이슈/관리 라우트를 모듈 레이아웃으로 감싸기
- `src/components/home/ModuleSidebar.tsx` — 삭제 (AppRail로 역할 흡수)

테스트:
- `e2e/pages/app-rail.spec.ts`, `e2e/pages/issue-sidebar.spec.ts`, `e2e/pages/global-chat.spec.ts`, `e2e/pages/admin-sidebar.spec.ts`

---

## Task 1: AppRail 유저 메뉴 컴포넌트

레일 하단 유저 드롭다운. 기존 `AppLayout` 헤더의 테마 토글 + 유저 드롭다운 로직을 재사용.

**Files:**
- Create: `src/components/layout/AppRailUserMenu.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// src/components/layout/AppRailUserMenu.tsx
// 앱 레일 하단의 유저 메뉴 — 프로필/테마 토글/로그아웃. collapsed 시 아이콘만.
import { useNavigate } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { LogOut, Moon, Sun, User as UserIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function AppRailUserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="사용자 메뉴"
          data-testid="rail-user-menu"
          className={cn(
            'flex w-full items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50',
            collapsed && 'justify-center',
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserIcon className="h-4 w-4" />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {user?.name ?? user?.username ?? '사용자'}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="start" className="w-48">
        <DropdownMenuLabel className="truncate">
          {user?.name ?? user?.username ?? '사용자'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserIcon className="mr-2 h-4 w-4" /> 프로필
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
          테마 전환
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/layout/AppRailUserMenu.tsx
git commit -m "feat(web): 앱 레일 하단 유저 메뉴 컴포넌트 추가"
```

---

## Task 2: AppRail 컴포넌트 (앱 런처 LNB)

fire-hub 사이드바 패턴 이식. 모듈 항목(홈/이슈) + coming-soon + 관리(어드민) + 유저메뉴. collapse 토글 localStorage 저장, 모바일 오버레이.

**Files:**
- Create: `src/components/layout/AppRail.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// src/components/layout/AppRail.tsx
// 앱 런처 LNB — 명시적으로 모듈(앱)을 띄우는 레일. 기능 카탈로그가 아님.
// 모듈 내부 깊은 네비는 각 모듈의 2차 사이드바가 담당한다.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  Home,
  Menu,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { AppRailUserMenu } from './AppRailUserMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface RailItem {
  label: string
  href: string
  icon: LucideIcon
  adminOnly?: boolean
}

// 활성화된 모듈 런처 항목
const MODULES: RailItem[] = [
  { label: '홈', href: '/', icon: Home },
  { label: '이슈', href: '/projects', icon: CircleDot },
]
// 어드민 전용 모듈
const ADMIN_MODULE: RailItem = { label: '관리', href: '/admin/users', icon: Shield }
// 예정 모듈 — 비활성 표시
const SOON = ['Chat', 'Wiki', 'Drive']

const STORAGE_KEY = 'app-rail-collapsed'

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

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
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }
  return link
}

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
              active={isActive(location.pathname, item.href)}
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
```

- [ ] **Step 2: tooltip ui 컴포넌트 존재 확인**

Run: `ls apps/workplace-web/src/components/ui/tooltip.tsx`
Expected: 파일 존재. 없으면 `pnpm --filter workplace-web dlx shadcn@latest add tooltip` 로 추가.

- [ ] **Step 3: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/src/components/layout/AppRail.tsx
git commit -m "feat(web): 앱 런처 LNB(AppRail) 컴포넌트 추가 — collapse/모바일 오버레이"
```

---

## Task 3: 홈 세션 Context — useHomeSession 전역화

`useHomeSession`을 `AppLayout` 레벨 Context로 끌어올려 챗 도크(전역)와 캔버스(홈)가 같은 세션 상태를 공유하게 한다.

**Files:**
- Create: `src/hooks/HomeSessionContext.tsx`

- [ ] **Step 1: Context/Provider 작성**

```tsx
// src/hooks/HomeSessionContext.tsx
// 홈 세션 상태(캔버스 + 챗 transcript)를 AppLayout 레벨에서 제공.
// 챗 도크는 전역 상주(모든 모듈), 캔버스는 홈 모듈 전용 — 둘이 같은 세션을 공유.
import { createContext, useContext, type ReactNode } from 'react'
import { useHomeSession } from './useHomeSession'
import type { WidgetSpec } from '@/types/home'

// 홈 캔버스 기본 위젯 사양
const DEFAULT_SPECS: WidgetSpec[] = [
  { type: 'my_tasks' },
  { type: 'issue_list', params: { assignee: 'me', status: 'IN_PROGRESS' } },
  { type: 'activity' },
]

type HomeSessionValue = ReturnType<typeof useHomeSession>

const HomeSessionContext = createContext<HomeSessionValue | null>(null)

export function HomeSessionProvider({ children }: { children: ReactNode }) {
  const session = useHomeSession(DEFAULT_SPECS)
  return <HomeSessionContext value={session}>{children}</HomeSessionContext>
}

// 세션 컨텍스트 소비 훅. Provider 밖에서 호출 시 에러.
export function useHomeSessionContext(): HomeSessionValue {
  const ctx = useContext(HomeSessionContext)
  if (!ctx) throw new Error('useHomeSessionContext must be used within HomeSessionProvider')
  return ctx
}
```

> 참고: `DEFAULT_SPECS`/`WidgetSpec` import 경로는 기존 `HomeShell.tsx`의 정의와 일치시킬 것. (`HomeShell.tsx`가 `WidgetSpec`을 어디서 import하는지 확인 후 동일 경로 사용.)

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/hooks/HomeSessionContext.tsx
git commit -m "feat(web): 홈 세션 상태 전역 Context(HomeSessionProvider) 추가"
```

---

## Task 4: 전역 챗 도크

기존 `FloatingChat`을 Context 소비 래퍼로 감싸고, 비-홈 모듈에서 제출 시 홈으로 라우팅 후 compose.

**Files:**
- Create: `src/components/layout/GlobalChatDock.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// src/components/layout/GlobalChatDock.tsx
// 전역 챗 도크 — 모든 모듈에서 하단 상주. AI Native의 주 진입점.
// 홈이 아닌 곳에서 제출하면 홈으로 이동해 캔버스에 결과를 구성("챗→compose→캔버스" 주 경로 보존).
import { useLocation, useNavigate } from 'react-router-dom'
import { FloatingChat } from '@/components/home/FloatingChat'
import { useHomeSessionContext } from '@/hooks/HomeSessionContext'

export function GlobalChatDock() {
  const session = useHomeSessionContext()
  const location = useLocation()
  const navigate = useNavigate()

  const handleSubmit = (query: string) => {
    // 홈이 아니면 캔버스가 보이도록 먼저 홈으로 이동
    if (location.pathname !== '/') navigate('/')
    session.submitQuery(query)
  }

  return <FloatingChat turns={session.turns} pending={session.pending} onSubmit={handleSubmit} />
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm --filter workplace-web typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add apps/workplace-web/src/components/layout/GlobalChatDock.tsx
git commit -m "feat(web): 전역 챗 도크(GlobalChatDock) — 비-홈 제출 시 홈 라우팅"
```

---

## Task 5: AppLayout 셸 전환 + HomeShell 정리

GNB 헤더 제거 → flex 셸(AppRail + Outlet + GlobalChatDock), 세션 Provider 적용. HomeShell에서 ModuleSidebar/FloatingChat 제거, Context 소비, GNB 높이 차감 제거.

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/home/HomeShell.tsx`
- Delete: `src/components/home/ModuleSidebar.tsx`

- [ ] **Step 1: E2E 실패 테스트 작성 (앱 레일/챗 전역)**

```ts
// e2e/pages/app-rail.spec.ts
import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  // 기존 모듈 사이드바는 제거됨
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('앱 레일 collapse 상태가 새로고침 후 유지된다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await page.getByTestId('rail-collapse-toggle').click()
  await page.reload()
  // 접힌 상태에서는 로고 텍스트가 숨겨진다
  await expect(page.getByTestId('app-rail').getByText('Smart Workplace')).toHaveCount(0)
})
```

```ts
// e2e/pages/global-chat.spec.ts
import { expect, test } from '../fixtures/auth.fixture'

test('이슈 페이지에서도 챗 도크가 상주한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/projects**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/projects')
  await expect(page.getByTestId('chat-input')).toBeVisible()
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter workplace-web exec playwright test app-rail global-chat`
Expected: FAIL (app-rail testid 없음 / 챗이 이슈 페이지에 없음)

- [ ] **Step 3: AppLayout 교체**

`src/components/layout/AppLayout.tsx` 전체를 아래로 교체:

```tsx
// src/components/layout/AppLayout.tsx
// 전역 셸 — 좌측 앱 런처 LNB + 모듈 콘텐츠 + 전역 챗 도크. 상단 GNB 없음.
import { Outlet } from 'react-router-dom'
import { useChatStream } from '@/hooks/useChatStream'
import { AppRail } from './AppRail'
import { GlobalChatDock } from './GlobalChatDock'
import { HomeSessionProvider } from '@/hooks/HomeSessionContext'

export function AppLayout() {
  useChatStream()

  return (
    <HomeSessionProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <AppRail />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
          <GlobalChatDock />
        </main>
      </div>
    </HomeSessionProvider>
  )
}
```

> `useChatStream` import 경로는 기존 파일의 import와 동일하게 유지.

- [ ] **Step 4: HomeShell 정리**

`src/components/home/HomeShell.tsx` 를 아래로 교체:

```tsx
// src/components/home/HomeShell.tsx
// 홈 모듈 콘텐츠 — AI 캔버스 + 세션 스위처. 챗 도크/네비는 전역 셸이 담당.
import { HomeCanvas } from './HomeCanvas'
import { SessionSwitcher } from './SessionSwitcher'
import { useSessions } from '@/hooks/useSessions'
import { useHomeSessionContext } from '@/hooks/HomeSessionContext'

export function HomeShell() {
  const session = useHomeSessionContext()
  const sessions = useSessions()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 캔버스 헤더 — 세션 스위처 */}
      <header className="flex h-10 shrink-0 items-center border-b px-4" data-testid="canvas-header">
        <SessionSwitcher
          sessions={sessions.data?.items ?? []}
          currentSessionId={session.sessionId}
          onNew={session.newSession}
          onSelect={session.restoreSession}
          onDelete={session.deleteSession}
        />
      </header>
      <div className="relative flex-1 overflow-hidden">
        <HomeCanvas pages={session.pages} activeIndex={session.activeIndex} onSelectPage={session.setActive} />
      </div>
    </div>
  )
}
```

> `useSessions`/`HomeCanvas`/`SessionSwitcher` import 경로는 기존 `HomeShell.tsx`의 것과 동일하게 유지. `h-[calc(100vh-3.5rem)]` → `h-full`로 변경(GNB 높이 차감 제거). `FloatingChat` import/사용 삭제.

- [ ] **Step 5: ModuleSidebar 삭제**

```bash
git rm apps/workplace-web/src/components/home/ModuleSidebar.tsx
```

- [ ] **Step 6: 기존 E2E의 module-sidebar 의존 수정**

`e2e/pages/auth.spec.ts` 에서 `getByTestId('module-sidebar')` 단언을 `getByTestId('app-rail')`로 교체 (3곳: 홈 진입/로그아웃/관련 테스트).

Run: `grep -rn "module-sidebar" apps/workplace-web/e2e`
Expected: 수정 후 결과 없음

- [ ] **Step 7: 타입체크 + E2E 재실행**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web exec playwright test app-rail global-chat auth`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/workplace-web/src
git commit -m "refactor(web): 상단 GNB 제거 → 앱 레일 LNB + 전역 챗 도크 셸로 전환"
```

---

## Task 6: 이슈 모듈 2차 사이드바

이슈 라우트에 2차 사이드바(내 태스크 + 프로젝트 목록 + 새 프로젝트)를 가진 중첩 레이아웃 추가.

**Files:**
- Create: `src/components/issue/IssueSidebar.tsx`
- Create: `src/components/issue/IssueModuleLayout.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: E2E 실패 테스트 작성**

```ts
// e2e/pages/issue-sidebar.spec.ts
import { expect, test } from '../fixtures/auth.fixture'

test('이슈 모듈에 2차 사이드바가 보이고 홈에는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/projects**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
  )
  await page.goto('/projects')
  await expect(page.getByTestId('issue-sidebar')).toBeVisible()
  await expect(page.getByTestId('issue-sidebar').getByRole('link', { name: '내 태스크' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByTestId('issue-sidebar')).toHaveCount(0)
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter workplace-web exec playwright test issue-sidebar`
Expected: FAIL (issue-sidebar testid 없음)

- [ ] **Step 3: IssueSidebar 작성**

```tsx
// src/components/issue/IssueSidebar.tsx
// 이슈 모듈 2차 사이드바 — cross-project 내 태스크 + 프로젝트 목록. 어느 보드에서든 즉시 전환.
import { NavLink } from 'react-router-dom'
import { ListChecks, Plus } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { cn } from '@/lib/utils'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
  )

export function IssueSidebar() {
  const projects = useProjects()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40 p-3" data-testid="issue-sidebar">
      <nav className="space-y-1">
        <NavLink to="/me/watched" className={linkClass}>
          <ListChecks className="h-4 w-4" /> 내 태스크
        </NavLink>
      </nav>

      <div className="mt-5">
        <div className="flex items-center justify-between px-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">프로젝트</span>
          <NavLink to="/projects" aria-label="새 프로젝트" className="text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" />
          </NavLink>
        </div>
        <nav className="mt-2 space-y-1">
          {(projects.data?.items ?? []).map((p) => (
            <NavLink key={p.key} to={`/projects/${p.key}`} className={linkClass}>
              <span className="truncate">{p.name}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  )
}
```

> `useProjects` 훅 / 반환 타입(`items`, `p.key`, `p.name`)은 기존 `ProjectListPage`가 쓰는 훅·타입과 일치시킬 것. 다르면 그 훅을 import해 동일 필드 사용.

- [ ] **Step 4: IssueModuleLayout 작성**

```tsx
// src/components/issue/IssueModuleLayout.tsx
// 이슈 라우트 레이아웃 — 2차 사이드바 + 콘텐츠.
import { Outlet } from 'react-router-dom'
import { IssueSidebar } from './IssueSidebar'

export function IssueModuleLayout() {
  return (
    <div className="flex h-full min-h-0 flex-1">
      <IssueSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: App.tsx 라우팅 — 이슈 라우트 감싸기**

`src/App.tsx`에서 이슈 관련 라우트(`projects`, `projects/:key`, `projects/:key/settings`, `projects/:key/issues/:number`, `me/watched`)를 `IssueModuleLayout` 자식으로 묶는다:

```tsx
// AppLayout 자식 라우트 내부
<Route element={<IssueModuleLayout />}>
  <Route path="projects" element={<ProjectListPage />} />
  <Route path="projects/:key" element={<ProjectDetailPage />} />
  <Route path="projects/:key/settings" element={<ProjectSettingsPage />} />
  <Route path="projects/:key/issues/:number" element={<IssueDetailPage />} />
  <Route path="me/watched" element={<WatchedPage />} />
</Route>
```

> 페이지 컴포넌트명(`ProjectDetailPage`, `ProjectSettingsPage`, `IssueDetailPage`, `WatchedPage`)은 기존 `App.tsx`의 실제 import 이름을 그대로 사용. import 문에 `IssueModuleLayout` 추가.

- [ ] **Step 6: 타입체크 + E2E 재실행**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web exec playwright test issue-sidebar`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src apps/workplace-web/e2e
git commit -m "feat(web): 이슈 모듈 2차 사이드바(내 태스크+프로젝트 목록) 추가"
```

---

## Task 7: 관리 모듈 2차 사이드바 (AGENT 흡수)

관리 라우트에 2차 사이드바(사용자/역할/감사로그/AGENT) 추가.

**Files:**
- Create: `src/components/admin/AdminSidebar.tsx`
- Create: `src/components/admin/AdminModuleLayout.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: E2E 실패 테스트 작성**

```ts
// e2e/pages/admin-sidebar.spec.ts
import { expect, test } from '../fixtures/auth.fixture'

test('관리 모듈 2차 사이드바에 AGENT가 포함된다', { tag: '@smoke' }, async ({ adminPage: page }) => {
  await page.route('**/api/v1/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/admin/users')
  const sidebar = page.getByTestId('admin-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'AGENT' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: '감사 로그' })).toBeVisible()
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter workplace-web exec playwright test admin-sidebar`
Expected: FAIL (admin-sidebar testid 없음)

- [ ] **Step 3: AdminSidebar 작성**

```tsx
// src/components/admin/AdminSidebar.tsx
// 관리 모듈 2차 사이드바 — 사용자/역할/감사로그/AGENT(비서 관리 흡수).
import { NavLink } from 'react-router-dom'
import { Bot, FileText, Shield, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { label: '사용자', href: '/admin/users', icon: Users },
  { label: '역할', href: '/admin/roles', icon: Shield },
  { label: '감사 로그', href: '/admin/audit-logs', icon: FileText },
  { label: 'AGENT', href: '/admin/agents', icon: Bot },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
  )

export function AdminSidebar() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar/40 p-3" data-testid="admin-sidebar">
      <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">관리</div>
      <nav className="space-y-1">
        {ITEMS.map(({ label, href, icon: Icon }) => (
          <NavLink key={href} to={href} className={linkClass} end={false}>
            <Icon className="h-4 w-4" /> {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 4: AdminModuleLayout 작성**

```tsx
// src/components/admin/AdminModuleLayout.tsx
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
```

- [ ] **Step 5: App.tsx — AdminRoute 안에 레이아웃 적용**

`src/App.tsx`의 `<Route element={<AdminRoute />}>` 자식들을 `AdminModuleLayout`으로 감싼다:

```tsx
<Route element={<AdminRoute />}>
  <Route element={<AdminModuleLayout />}>
    <Route path="admin/users" element={<UserListPage />} />
    <Route path="admin/users/:id" element={<UserDetailPage />} />
    <Route path="admin/roles" element={<RoleListPage />} />
    <Route path="admin/roles/:id" element={<RoleDetailPage />} />
    <Route path="admin/audit-logs" element={<AuditLogPage />} />
    <Route path="admin/agents" element={<AgentListPage />} />
  </Route>
</Route>
```

> 페이지 컴포넌트명은 기존 `App.tsx`의 실제 import 이름을 그대로 사용. import에 `AdminModuleLayout` 추가.

- [ ] **Step 6: 타입체크 + E2E 재실행**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web exec playwright test admin-sidebar`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src apps/workplace-web/e2e
git commit -m "feat(web): 관리 모듈 2차 사이드바 + AGENT 메뉴 흡수"
```

---

## Task 8: 전체 검증 + 정리

**Files:** (검증 전용)

- [ ] **Step 1: 전체 타입체크/린트**

Run: `pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint`
Expected: PASS

- [ ] **Step 2: 전체 E2E (smoke) 실행**

Run: `pnpm --filter workplace-web exec playwright test --grep @smoke`
Expected: PASS (전 항목)

- [ ] **Step 3: 잔존 참조 점검**

Run: `grep -rn "ModuleSidebar\|module-sidebar\|h-\[calc(100vh-3.5rem)\]\|FloatingChat" apps/workplace-web/src`
Expected: `FloatingChat`은 `GlobalChatDock.tsx`에서만 참조. `ModuleSidebar`/`module-sidebar`/GNB 높이 차감 잔존 없음.

- [ ] **Step 4: 수동 시각 확인 (선택)**

Run: `pnpm --filter workplace-web dev` 후 브라우저에서 홈/이슈/관리 전환, collapse, 모바일 폭 확인.

- [ ] **Step 5: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "chore(web): LNB/GNB 레이아웃 재정리 마무리 검증"
```

---

## Self-Review 체크

- **Spec 커버리지**: GNB 제거(T5) / 앱 런처 LNB(T2,T1) / 2차 사이드바 이슈(T6)·관리+AGENT 흡수(T7) / 챗 전역 상주(T3,T4,T5) / collapse+localStorage·모바일(T2) / 홈 GNB 높이 차감 제거·ModuleSidebar 흡수(T5) — 모두 태스크 존재. ✅
- **열린 점**: 챗 전역화 시 `useHomeSession` 범위 → T3 Context로 해소. 모듈 레이아웃 = 중첩 라우트 레이아웃으로 확정(T6/T7). ✅
- **주의(실행자)**: 코드 블록의 import 경로/페이지 컴포넌트명/`useProjects`·`WidgetSpec` 타입은 기존 파일과 대조해 정확히 맞출 것 — 본 계획은 구조를 규정하고, 식별자는 현 코드 기준으로 정렬한다.
