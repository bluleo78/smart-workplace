import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'

// v1 골격용 슬림 레이아웃 — 헤더 + 본문.
// 사이드바·인증·내비게이션은 #11/#12 에서 본격 도입.
export function AppLayout() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-14 border-b flex items-center justify-between px-4">
        <Link to="/" className="font-semibold">
          Smart Workplace
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="테마 전환"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
