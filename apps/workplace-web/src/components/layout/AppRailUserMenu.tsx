// src/components/layout/AppRailUserMenu.tsx
// 앱 레일 하단의 유저 메뉴 — 프로필/테마 토글/로그아웃.
// 아이콘 레일이므로 데스크톱(lg)은 아바타만, 모바일 드로어는 아바타+이름.
import { LogOut, Moon, Sun, User as UserIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

export function AppRailUserMenu() {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const { user, logout } = useAuth()

  // 로그아웃 — 서버 세션 종료 후 로그인 페이지로 이동
  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="사용자 메뉴"
              data-testid="rail-user-menu"
              className={cn(
                'flex w-full items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50',
                'lg:justify-center',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserIcon className="h-4 w-4" />
              </span>
              {/* 모바일 드로어에서만 이름 노출. 데스크톱 아이콘 레일은 아바타만. */}
              <span className="min-w-0 flex-1 truncate text-left font-medium lg:hidden">
                {user?.name ?? user?.username ?? '사용자'}
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* 데스크톱 아이콘 레일에서 hover 시 라벨 노출 (nav 링크와 동일 패턴) */}
        <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
          내 계정
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-48">
        <DropdownMenuLabel className="truncate">
          {user?.name ?? user?.username ?? '사용자'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
          <UserIcon className="h-4 w-4" /> 프로필
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          테마 전환
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOut className="h-4 w-4" /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
