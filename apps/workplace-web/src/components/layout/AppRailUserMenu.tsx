// src/components/layout/AppRailUserMenu.tsx
// 앱 레일 하단의 유저 메뉴 — 프로필/테마 토글/로그아웃.
// 아이콘 레일이므로 데스크톱(lg)은 아바타만, 모바일 드로어는 아바타+이름.
import { LogOut, Moon, Sparkles, Sun, User as UserIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvatarPicture } from '@/components/users/AvatarPicture'
import { useWhatsNew } from '@/components/whats-new/useWhatsNew'
import { WhatsNewDot } from '@/components/whats-new/WhatsNewDot'
import { useAuth } from '@/hooks/useAuth'
import { useSignOut } from '@/hooks/useSignOut'
import { useThemeToggle } from '@/hooks/useThemeToggle'
import { presenceStyle } from '@/lib/collab/presence'
import { cn, displayNameOf, initialOf } from '@/lib/utils'

// 새 소식 창은 처음 열 때 불러온다(WP-970) — 릴리스 노트 마크다운 렌더러(react-markdown·remark)가 앱 첫 부팅에 실리지 않게.
const WhatsNewDialog = lazy(() => import('@/components/whats-new/WhatsNewDialog').then((m) => ({ default: m.WhatsNewDialog })))

export function AppRailUserMenu({ expanded = false }: { expanded?: boolean }) {
  const navigate = useNavigate()
  const { dark, toggle } = useThemeToggle()
  const { user } = useAuth()
  // 로그아웃 — 서버 세션 종료 후 로그인 페이지로 이동(모바일 계정 시트와 공용 훅)
  const handleLogout = useSignOut()
  // 새 소식 — 안 읽음 점(아바타·항목)과 릴리스 노트 창(WP-439).
  const whatsNew = useWhatsNew()
  // 한 번 연 창은 계속 마운트해 둔다 — 닫힘 전환이 예전과 같게.
  const [whatsNewMounted, setWhatsNewMounted] = useState(false)
  if (whatsNew.open && !whatsNewMounted) setWhatsNewMounted(true)

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
                // 데스크톱: p-1 고정으로 아바타 위치 불변(justify 전환 제거). 모바일: p-2.
                'flex w-full items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent/50',
                'lg:p-1',
              )}
            >
              {/* 내 아바타 — 올린 이미지(WP-1222) 또는 다른 사람 아바타와 같은 사람 색(bg-presence + presenceStyle, WP-318) + 이니셜. 사용자 로드 전엔 아이콘. */}
              <span
                data-testid="rail-user-avatar"
                className={cn(
                  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  user ? 'bg-presence text-presence-foreground' : 'bg-muted text-muted-foreground',
                )}
                style={user ? presenceStyle(user.id) : undefined}
              >
                {user ? (
                  <AvatarPicture userId={user.id} name={displayNameOf(user)} px={28}>
                    {initialOf(displayNameOf(user))}
                  </AvatarPicture>
                ) : (
                  <UserIcon className="h-4 w-4" />
                )}
                {/* 안 읽은 새 소식 — 아바타 우상단 점. 배경색 링으로 아바타와 분리한다. */}
                {whatsNew.unread && (
                  <WhatsNewDot testId="rail-user-avatar-dot" className="absolute -right-0.5 -top-0.5 ring-2 ring-background" />
                )}
              </span>
              {/* 모바일 드로어에서는 항상, 데스크톱은 max-width+opacity 전환으로 부드럽게 숨김/표시. */}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-left font-medium overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200',
                  // 80px 상한은 실제 가용폭(~87px)보다 좁아 불필요하게 잘렸다(WP-198) — 가용폭은 flex-1 이 제한.
                  expanded ? 'lg:max-w-[100px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0',
                )}
              >
                {user?.name ?? user?.username ?? '사용자'}
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* 축소 시에만 hover 툴팁(확장 시엔 이름이 직접 보임). */}
        {!expanded && (
          <TooltipContent side="right" sideOffset={8} className="hidden lg:block">
            내 계정
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-48">
        <DropdownMenuLabel className="truncate">
          {user?.name ?? user?.username ?? '사용자'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
          <UserIcon className="h-4 w-4" /> 프로필
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="whats-new-menu-item"
          // 커밋은 보조 정보라 항목 본문 대신 툴팁으로(로컬 빌드는 커밋이 없어 생략).
          title={__GIT_SHA_SHORT__ ? `커밋 ${__GIT_SHA_SHORT__}` : undefined}
          onSelect={() => whatsNew.setOpen(true)}
        >
          <Sparkles className="h-4 w-4" /> 새 소식
          {whatsNew.unread && <WhatsNewDot testId="whats-new-dot" />}
          <span className="ml-auto text-xs text-muted-foreground">{__APP_VERSION_LABEL__}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggle}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          테마 전환
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOut className="h-4 w-4" /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
      {/* 창은 메뉴 항목이 아니라 DropdownMenu 의 형제 자리에 둔다(DOM 을 만들지 않는 루트라 포털로 뜬다) — 항목 선택으로 메뉴가 닫혀도 창은 유지된다. */}
      {whatsNewMounted && (
        <Suspense fallback={null}>
          <WhatsNewDialog open={whatsNew.open} onOpenChange={whatsNew.setOpen} />
        </Suspense>
      )}
    </DropdownMenu>
  )
}
