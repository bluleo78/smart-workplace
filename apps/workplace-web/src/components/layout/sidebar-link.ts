// 모듈 2차 사이드바 공통 NavLink 클래스 — 활성/비활성 스타일.
import { cn } from '@/lib/utils'

export const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
  )
