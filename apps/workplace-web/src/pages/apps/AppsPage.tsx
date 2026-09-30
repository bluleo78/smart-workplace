// /apps — 모바일 앱 목록(안드로이드 런처식, WP-121). 모든 앱을 한 그리드에 보이고, 탭바에 고정된 앱엔 표시를 붙인다.
// 아이콘을 길게 누르면(또는 우클릭) 액션 메뉴 — 탭바에 고정(꽉 찼으면 바꿀 탭 선택)·다른 앱으로 교체·열기.
// 계정·워크스페이스는 본문에서 빼 우상단 아바타 → 하단 시트로 분리했다(Teams·Slack 방식). 모바일 전용.
import { type LucideIcon, Pin, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { AccountSheet } from '@/components/mobile/AccountSheet'
import { useTabSlots } from '@/components/mobile/MobileChromeContext'
import { MobileListHeader } from '@/components/mobile/MobileListHeader'
import { NotificationBell } from '@/components/mobile/NotificationBell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAuth } from '@/hooks/useAuth'
import { useLongPress } from '@/hooks/useLongPress'
import { replaceSlot } from '@/lib/mobile/tabConfig'
import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'
import { cn, displayNameOf, eulReul, initialOf } from '@/lib/utils'

import { AppActionMenu } from './AppActionMenu'

/** 그리드 한 칸의 표시 정보 — 탭 레지스트리 앱 + 탭바에 둘 수 없는 설정. */
interface AppEntry {
  id: MobileTabId | 'settings'
  label: string
  icon: LucideIcon
  path: string
}

// 그리드 순서 = 탭 레지스트리 순서 뒤에 설정. 설정은 탭바에 고정할 수 없다(탭 레지스트리 밖).
const APPS: AppEntry[] = [
  ...ALL_TAB_IDS.map((id) => MOBILE_TABS[id]),
  { id: 'settings', label: '설정', icon: Settings, path: '/settings' },
]

/** 앱 아이콘 한 칸 — 짧은 탭은 이동, 길게 누르기/우클릭은 onMenu(고정 가능한 앱만 — 없으면 이동만). */
function AppButton({ app, pinned, onMenu }: { app: AppEntry; pinned: boolean; onMenu?: () => void }) {
  const navigate = useNavigate()
  const handlers = useLongPress(onMenu, () => navigate(app.path))
  const Icon = app.icon
  return (
    <button
      type="button"
      data-testid={`apps-app-${app.id}`}
      aria-label={pinned ? `${app.label}, 탭바에 고정됨` : app.label}
      {...handlers}
      // 길게 누를 때 iOS 콜아웃·텍스트 선택이 뜨지 않게 한다.
      className="flex min-h-11 min-w-11 select-none flex-col items-center gap-1 py-1 text-xs [-webkit-touch-callout:none]"
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-xl border bg-card">
        <Icon className="h-5 w-5" />
        {pinned && (
          <span
            data-testid={`apps-pinned-${app.id}`}
            aria-hidden
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Pin className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
      {app.label}
    </button>
  )
}

export default function AppsPage() {
  const [slots, setSlots] = useTabSlots()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [accountOpen, setAccountOpen] = useState(false)
  // 액션 메뉴가 열린 앱. null 이면 닫힘. 메뉴 단계는 AppActionMenu 가 스스로 가진다.
  const [menuFor, setMenuFor] = useState<MobileTabId | null>(null)
  const closeMenu = () => setMenuFor(null)

  // from 칸을 to 앱으로 제자리 교체 → 탭바 즉시 반영·localStorage 저장. 실제로 바뀐 경우에만 토스트로 확인.
  const replace = (from: MobileTabId, to: MobileTabId) => {
    closeMenu()
    const next = replaceSlot(slots, from, to)
    if (next === slots) return
    setSlots(next)
    const label = MOBILE_TABS[to].label
    toast.success(`${label}${eulReul(label)} 탭바에 고정했어요`)
  }

  const avatar = (
    <button
      type="button"
      data-testid="apps-account"
      aria-label="내 계정"
      onClick={() => setAccountOpen(true)}
      // mr-1.5 — 헤더 우 여백(pr-1)은 44px 아이콘 버튼의 글리프 기준이라, 32px 원형 아바타는 그대로 두면 화면 끝 10px 에 붙는다.
      // 원 가장자리를 다른 헤더 글리프와 같은 우측 약 16px 선에 맞춘다.
      className="mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <Avatar>
        <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initialOf(displayNameOf(user))}</AvatarFallback>
      </Avatar>
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* 목업 순서(벨 → 아바타)대로 — MobileListHeader 기본 벨은 actions 뒤에 붙으므로 숨기고 직접 배치한다. */}
      <MobileListHeader title="앱" hideBell actions={<><NotificationBell />{avatar}</>} />
      <div className="grid grid-cols-4 gap-x-1 gap-y-3 px-3 py-2">
        {APPS.map((app) => {
          if (app.id === 'settings') return <AppButton key={app.id} app={app} pinned={false} />
          const id = app.id
          return (
            <Popover key={id} open={menuFor === id} onOpenChange={(o) => { if (!o) closeMenu() }}>
              <PopoverAnchor asChild>
                <div className={cn('flex justify-center', menuFor === id && 'relative z-10')}>
                  <AppButton app={app} pinned={slots.includes(id)} onMenu={() => setMenuFor(id)} />
                </div>
              </PopoverAnchor>
              {/* collisionPadding: 끝 열(캘린더 등) 메뉴가 화면 가장자리에 붙지 않게 16px 여백. */}
              <PopoverContent data-testid="apps-menu" align="center" collisionPadding={16} className="w-52 p-0 py-1">
                <AppActionMenu id={id} slots={slots} onReplace={replace} onOpen={() => { closeMenu(); navigate(app.path) }} />
              </PopoverContent>
            </Popover>
          )
        })}
      </div>
      <p className="mt-3 px-4 text-center text-xs text-muted-foreground">
        길게 눌러 탭바에 고정 ·{' '}
        <Link to="/apps/tabs" data-testid="apps-edit-tabs" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
          탭바 순서 편집
        </Link>
      </p>
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  )
}
