// src/components/layout/WorkspaceSwitcher.tsx
// 앱 레일 상단의 워크스페이스(테넌트) 스위처 칩.
// 현재 워크스페이스를 표시하고, 클릭 시 멤버십 목록을 lazy fetch 해 전환 메뉴를 연다.
// 멤버십이 1개뿐이면 표시 전용(전환 비활성). 데스크톱(lg)은 아바타만, 모바일은 아바타+이름.
import { Building2, Check } from 'lucide-react'
import { useState } from 'react'

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
import { useWorkspaceOptions } from '@/hooks/useWorkspaceOptions'
import { cn, initialOf } from '@/lib/utils'

export function WorkspaceSwitcher({ expanded = false }: { expanded?: boolean }) {
  const { selectTenant } = useAuth()
  // 드롭다운이 열릴 때만 멤버십 목록을 페치(매 페이지 마운트 시 페치 방지) — 모바일 계정 시트와 같은 훅.
  const [open, setOpen] = useState(false)
  const { activeTenant, list, loading, isCurrent } = useWorkspaceOptions(open)

  // 활성 테넌트가 없으면(미선택/무소속/기존 테스트) 칩을 렌더하지 않는다.
  if (!activeTenant) return null

  const initial = initialOf(activeTenant.tenantName)
  const canSwitch = list.length > 1

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 데스크톱(lg) 아이콘 레일에서 호버 시 워크스페이스 이름을 Tooltip으로 표시. 모바일 드로어에서는 숨김. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="워크스페이스 전환"
              data-testid="workspace-switcher"
              className={cn(
                // 데스크톱: p-1 고정으로 아바타 위치 불변(justify 전환 제거). 모바일: p-2.
                'flex w-full items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50',
                'lg:p-1',
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold">
                {initial}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-left font-semibold overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200',
                  expanded ? 'lg:max-w-[80px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0',
                )}
              >
                {activeTenant.tenantName}
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!expanded && (
          <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
            {activeTenant.tenantName}
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-56">
        <DropdownMenuLabel className="truncate">
          {loading ? '불러오는 중…' : '워크스페이스'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.map((m) => {
          const current = isCurrent(m)
          return (
            <DropdownMenuItem
              key={m.tenantId}
              data-testid={`workspace-switch-${m.tenantId}`}
              disabled={current || !canSwitch}
              onSelect={() => {
                if (!current) void selectTenant(m)
              }}
              className="gap-2"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                <Building2 className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">{m.tenantName}</span>
              {current && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
