import { Link, Outlet } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { Button } from './ui/button'

// 운영자 콘솔 공통 레이아웃.
// - 상단 헤더(landmark): 좌측 앱 타이틀(홈 링크), 우측 현재 운영자 이름 + 로그아웃.
// - 본문은 <main> 안에 <Outlet/> 으로 하위 라우트를 렌더한다.
export function AdminLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="font-semibold" data-testid="admin-home">
            운영자 콘솔
          </Link>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-muted-foreground">{user.name}</span>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void logout()}
              data-testid="admin-logout"
            >
              로그아웃
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
