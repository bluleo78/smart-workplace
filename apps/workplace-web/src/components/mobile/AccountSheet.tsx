// 모바일 계정 시트 — 앱 목록 우상단 아바타에서 여는 하단 시트(Teams·Slack 방식).
// 데스크톱 레일의 WorkspaceSwitcher·AppRailUserMenu 가 하던 일(워크스페이스 전환·프로필·로그아웃)을
// 드롭다운 대신 터치에 맞는 목록으로 보여준다(테마 전환 포함 — 모바일에서 기능이 사라지지 않게). 모바일 앱 목록(/apps) 전용.
// 멤버십 lazy fetch·로그아웃·테마 전환은 데스크톱 컴포넌트와 같은 공용 훅을 쓴다.
import { Building2, Check, LogOut, Moon, Sun, User as UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/useAuth'
import { useSignOut } from '@/hooks/useSignOut'
import { useThemeToggle } from '@/hooks/useThemeToggle'
import { useWorkspaceOptions } from '@/hooks/useWorkspaceOptions'
import { presenceStyle } from '@/lib/collab/presence'
import { cn, displayNameOf, initialOf } from '@/lib/utils'

/** 시트의 한 줄 동작(프로필·테마·로그아웃) — 위 구분선 + 44px 전폭 버튼. */
function SheetRow({ testId, onClick, className, children }: {
  testId: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <div className="border-t">
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        className={cn('flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm', className)}
      >
        {children}
      </button>
    </div>
  )
}

/**
 * 워크스페이스 목록 — 시트가 열릴 때만 멤버십을 불러온다(WorkspaceSwitcher 와 같은 훅).
 * 실패 시 현재 워크스페이스만 보여 전환 불가 상태로 둔다. 활성 테넌트가 없으면 섹션 자체를 숨긴다.
 */
function WorkspaceList({ open }: { open: boolean }) {
  const { selectTenant } = useAuth()
  const { activeTenant, list, isCurrent } = useWorkspaceOptions(open)
  if (!activeTenant) return null
  return (
    <section>
      <h3 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">워크스페이스</h3>
      <ul>
        {list.map((m) => {
          const current = isCurrent(m)
          return (
            <li key={m.tenantId}>
              <button
                type="button"
                data-testid={`apps-workspace-${m.tenantId}`}
                aria-current={current ? 'true' : undefined}
                // 현재 워크스페이스는 누를 필요가 없고, 다른 워크스페이스를 누르면 전환(AuthContext 가 새 토큰 발급·리로드).
                disabled={current}
                onClick={() => { if (!current) void selectTenant(m) }}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-1 text-left text-sm disabled:opacity-100"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Building2 className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{m.tenantName}</span>
                {current && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="현재 워크스페이스" />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 계정 하단 시트 — 사용자 이름·아이디/이메일, 워크스페이스 목록, 프로필, 테마 전환, 로그아웃. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  // 테마 전환 — 시트는 닫지 않아 결과를 바로 본다.
  const { dark, toggle } = useThemeToggle()
  const signOut = useSignOut()
  const displayName = displayNameOf(user)

  // 로그아웃 — 시트를 먼저 닫고 서버 세션 종료 후 로그인 화면으로.
  const handleLogout = () => {
    onOpenChange(false)
    void signOut()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid="apps-account-sheet"
        className="gap-2 rounded-t-2xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
      >
        <div aria-hidden className="mx-auto h-1 w-8 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center gap-3 py-2 pr-8">
          {/* 내 아바타 — 다른 사람 아바타와 같은 사람 색(WP-318). */}
          <Avatar size="lg" style={user ? presenceStyle(user.id) : undefined}>
            <AvatarFallback className="bg-presence font-semibold text-presence-foreground">{initialOf(displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">{displayName}</SheetTitle>
            <p className="truncate text-xs text-muted-foreground">{user?.email || user?.username}</p>
          </div>
        </div>
        <SheetDescription className="sr-only">계정 정보와 워크스페이스 전환, 프로필, 로그아웃</SheetDescription>
        <WorkspaceList open={open} />
        <SheetRow testId="apps-profile" onClick={() => { onOpenChange(false); navigate('/settings/profile') }}>
          <UserIcon className="h-4 w-4" /> 프로필
        </SheetRow>
        <SheetRow testId="apps-account-theme" onClick={toggle}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} 테마 전환
        </SheetRow>
        <SheetRow testId="apps-logout" onClick={handleLogout} className="text-destructive">
          <LogOut className="h-4 w-4" /> 로그아웃
        </SheetRow>
      </SheetContent>
    </Sheet>
  )
}
