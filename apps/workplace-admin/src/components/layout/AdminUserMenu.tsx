// 운영자 콘솔 사이드바 하단의 프로필 메뉴 — 이름/테마 전환/로그아웃.
// 고객 콘솔 AppRailUserMenu 패턴을 운영자 콘솔(라벨형 사이드바)에 맞춰 미러한다.
import { LogOut, Moon, Sun, User as UserIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

export function AdminUserMenu() {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const { user, logout } = useAuth()

  // 로그아웃 — 서버 세션 종료 후 로그인 페이지로 이동
  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const display = user?.name ?? user?.username ?? '운영자'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="사용자 메뉴"
          data-testid="admin-user-menu"
          className="flex w-full items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">{display}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-48">
        <DropdownMenuLabel className="truncate">{display}</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
