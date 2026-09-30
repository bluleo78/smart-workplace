// 모바일 계정 시트 — 앱 목록 우상단 아바타에서 여는 하단 시트(Teams·Slack 방식).
// 데스크톱 레일의 WorkspaceSwitcher·AppRailUserMenu 가 하던 일(워크스페이스 전환·프로필·로그아웃)을
// 드롭다운 대신 터치에 맞는 목록으로 보여준다. 모바일 앱 목록(/apps) 전용.
import { Building2, Check, LogOut, User as UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { authApi } from '@/api/auth'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/hooks/useAuth'
import type { Membership } from '@/types/auth'

/** 표시 이름의 첫 글자 — 아바타 이니셜(이름이 없으면 아이디, 그것도 없으면 가운뎃점). */
// eslint-disable-next-line react-refresh/only-export-components
export function userInitial(name?: string | null): string {
  return name?.trim().charAt(0) || '·'
}

/**
 * 워크스페이스 목록 — 시트가 열릴 때만 멤버십을 불러온다(WorkspaceSwitcher 와 같은 lazy fetch).
 * 실패 시 현재 워크스페이스만 보여 전환 불가 상태로 둔다. 활성 테넌트가 없으면 섹션 자체를 숨긴다.
 */
function WorkspaceList({ open }: { open: boolean }) {
  const { activeTenant, selectTenant } = useAuth()
  const [options, setOptions] = useState<Membership[] | null>(null)

  useEffect(() => {
    if (!open || !activeTenant || options !== null) return
    let ignore = false
    authApi.memberships()
      .then(({ data }) => { if (!ignore) setOptions(data) })
      .catch(() => { if (!ignore) setOptions([activeTenant]) })
    return () => { ignore = true }
  }, [open, activeTenant, options])

  if (!activeTenant) return null
  const list = options ?? [activeTenant]
  return (
    <section>
      <h3 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">워크스페이스</h3>
      <ul>
        {list.map((m) => {
          const current = m.tenantId === activeTenant.tenantId
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

/** 계정 하단 시트 — 사용자 이름·아이디/이메일, 워크스페이스 목록, 프로필, 로그아웃. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const displayName = user?.name || user?.username || '사용자'

  // 로그아웃 — AppRailUserMenu 와 동일하게 서버 세션 종료 후 로그인 화면으로(뒤로가기로 돌아오지 않게 replace).
  const handleLogout = async () => {
    onOpenChange(false)
    await logout()
    navigate('/login', { replace: true })
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
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
            {userInitial(displayName)}
          </span>
          <div className="min-w-0">
            <SheetTitle className="truncate text-base">{displayName}</SheetTitle>
            <p className="truncate text-xs text-muted-foreground">{user?.email || user?.username}</p>
          </div>
        </div>
        <SheetDescription className="sr-only">계정 정보와 워크스페이스 전환, 프로필, 로그아웃</SheetDescription>
        <WorkspaceList open={open} />
        <div className="border-t">
          <button
            type="button"
            data-testid="apps-profile"
            onClick={() => { onOpenChange(false); navigate('/settings/profile') }}
            className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm"
          >
            <UserIcon className="h-4 w-4" /> 프로필
          </button>
        </div>
        <div className="border-t">
          <button
            type="button"
            data-testid="apps-logout"
            onClick={() => void handleLogout()}
            className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm text-destructive"
          >
            <LogOut className="h-4 w-4" /> 로그아웃
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
