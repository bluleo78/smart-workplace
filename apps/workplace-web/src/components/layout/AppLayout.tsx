import { LogOut, Moon, Sun, User as UserIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '../../hooks/useAuth'

// v1 골격용 슬림 레이아웃 — 헤더 + 본문.
// 인증된 사용자에게는 헤더 우측에 사용자 메뉴(프로필/로그아웃)를 노출한다.
export function AppLayout() {
  const { resolvedTheme, setTheme } = useTheme()
  const { isAuthenticated, isAdmin, user, logout } = useAuth()
  const navigate = useNavigate()

  // 로그아웃 — 서버 세션 종료 후 로그인 페이지로 이동
  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-14 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-semibold">
            Smart Workplace
          </Link>
          {isAuthenticated && (
            <nav aria-label="주 메뉴" className="flex items-center gap-4 text-sm">
              <NavLink
                to="/projects"
                className={({ isActive }) =>
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }
              >
                프로젝트
              </NavLink>
              <NavLink
                to="/me/watched"
                className={({ isActive }) =>
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }
              >
                내 태스크
              </NavLink>
              {isAdmin && (
                <NavLink
                  to="/admin/users"
                  className={({ isActive }) =>
                    isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }
                >
                  관리자
                </NavLink>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="테마 전환"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {isAuthenticated && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="사용자 메뉴">
                  <UserIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="truncate">
                  {user?.name ?? user?.username ?? '사용자'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <UserIcon className="h-4 w-4" />
                  프로필
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
