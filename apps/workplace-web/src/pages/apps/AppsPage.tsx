// /apps — 모바일 앱 목록(안드로이드 런처식, WP-121). 모든 앱을 한 그리드에 보이고, 탭바에 고정된 앱엔 표시를 붙인다.
// 아이콘을 길게 누르면(또는 우클릭) 액션 메뉴 — 탭바에 고정(꽉 찼으면 바꿀 탭 선택)·다른 앱으로 교체·열기.
// 계정·워크스페이스는 본문에서 빼 우상단 아바타 → 하단 시트로 분리했다(Teams·Slack 방식). 모바일 전용.
import { Hand, type LucideIcon, Pin, Settings, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
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

// 길게 누르기 안내(코치마크)를 이미 보여줬는지 — 기기별 1회. 저장소 접근 불가 환경이면 매번 보여도 무해하다.
const COACH_KEY = 'apps-coach-seen'
function readCoachSeen(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === '1'
  } catch {
    return false
  }
}
function writeCoachSeen() {
  try {
    localStorage.setItem(COACH_KEY, '1')
  } catch {
    // 저장 불가 환경 — 다음 방문에 다시 보일 뿐.
  }
}

/** 앱 아이콘 한 칸 — 짧은 탭은 이동, 길게 누르기/우클릭은 onMenu(고정 가능한 앱만 — 없으면 이동만). */
function AppButton({ app, pinned, lifted = false, onMenu }: { app: AppEntry; pinned: boolean; lifted?: boolean; onMenu?: () => void }) {
  const navigate = useNavigate()
  const handlers = useLongPress(onMenu, () => navigate(app.path))
  const Icon = app.icon
  return (
    <button
      type="button"
      data-testid={`apps-app-${app.id}`}
      aria-label={pinned ? `${app.label}, 탭바에 고정됨` : app.label}
      {...handlers}
      // 길게 누를 때 iOS 콜아웃(링크 미리보기·복사)·텍스트 선택이 뜨지 않게 한다.
      className="flex min-h-11 min-w-11 select-none flex-col items-center gap-1 py-1 text-xs [-webkit-touch-callout:none]"
    >
      {/* 메뉴가 열린 동안 아이콘에 그림자 — 스크림 위로 들린 느낌(크기 확대는 칸 래퍼가 담당). */}
      <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl border bg-card transition-shadow', lifted && 'shadow-lg')}>
        <Icon className="h-5 w-5" />
      </span>
      {app.label}
    </button>
  )
}

/**
 * 탭바에 둘 수 있는 앱 한 칸 — 아이콘 버튼 + (고정됨) 📌 배지 버튼 + 액션 메뉴 Popover.
 * 배지는 아이콘 버튼 안에 넣으면 버튼 중첩(무효 HTML)이 되므로 형제 버튼으로 아이콘 우상단에 겹쳐 둔다.
 * 배지를 눌러도 길게 누르기와 같은 메뉴가 열린다(고정 표시가 곧 "고정 관리" 진입점).
 */
function PinnableTile({ app, id, pinned, open, onOpenMenu, onCloseMenu, menu }: {
  app: AppEntry
  id: MobileTabId
  pinned: boolean
  open: boolean
  onOpenMenu: () => void
  onCloseMenu: () => void
  menu: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) onCloseMenu() }}>
      <PopoverAnchor asChild>
        {/* 메뉴가 열리면 칸을 1.08배로 들어 스크림(z-40) 위에 둔다 — 어느 앱의 메뉴인지 한눈에. */}
        <div className={cn('relative flex justify-center transition-transform duration-150', open && 'z-[41] scale-[1.08]')}>
          <AppButton app={app} pinned={pinned} lifted={open} onMenu={onOpenMenu} />
          {pinned && (
            // 28px 투명 터치 영역 안에 16px 배지 — 아이콘(48px, 칸 가운데) 우상단 모서리에 걸친다.
            <button
              type="button"
              data-testid={`apps-pinned-${id}`}
              aria-label={`${app.label} 탭바 고정 메뉴`}
              onClick={onOpenMenu}
              className="absolute -top-1.5 left-[calc(50%+6px)] flex h-7 w-7 items-center justify-center"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Pin className="h-2.5 w-2.5" />
              </span>
            </button>
          )}
        </div>
      </PopoverAnchor>
      {/* 칸(아이콘+이름) 바로 아래에 붙여 누른 앱의 이름을 가리지 않는다. collisionPadding: 끝 열 메뉴가 화면 가장자리에 붙지 않게. */}
      <PopoverContent data-testid="apps-menu" side="bottom" align="center" sideOffset={4} collisionPadding={16} className="w-52 p-0 py-1">
        {menu}
      </PopoverContent>
    </Popover>
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
  // 길게 누르기 안내 — 처음 한 번만(보여준 순간 기록). 닫기·실제 길게 누르기로 사라진다.
  const [coach, setCoach] = useState(() => !readCoachSeen())
  // 첫 화면을 본 순간 "봤음"으로 기록 — 다음 방문부터는 뜨지 않는다(이번 방문에선 닫을 때까지 유지).
  useEffect(() => writeCoachSeen(), [])

  // 메뉴 열기 — 짧은 진동(지원 기기만, iOS Safari 는 미지원이라 옵셔널 호출)으로 길게 누르기가 인식됐음을 알린다.
  const openMenu = (id: MobileTabId) => {
    navigator.vibrate?.(10)
    setMenuFor(id)
    setCoach(false)
  }

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
      {coach && (
        <div data-testid="apps-coach" role="note" className="mx-4 mb-1 flex min-h-11 items-center gap-2 rounded-lg bg-primary/10 pl-3 text-sm text-primary">
          <Hand className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">길게 눌러 탭바에 고정</span>
          <button type="button" data-testid="apps-coach-dismiss" aria-label="안내 닫기" onClick={() => setCoach(false)}
            className="flex h-11 w-11 shrink-0 items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="grid grid-cols-4 gap-x-1 gap-y-3 px-3 py-2">
        {APPS.map((app) => {
          if (app.id === 'settings') return <AppButton key={app.id} app={app} pinned={false} />
          const id = app.id
          return (
            <PinnableTile
              key={id}
              app={app}
              id={id}
              pinned={slots.includes(id)}
              open={menuFor === id}
              onOpenMenu={() => openMenu(id)}
              onCloseMenu={closeMenu}
              menu={<AppActionMenu id={id} slots={slots} onReplace={replace} onOpen={() => { closeMenu(); navigate(app.path) }} />}
            />
          )
        })}
      </div>
      <p className="mt-3 px-4 text-center">
        <Link to="/apps/tabs" data-testid="apps-edit-tabs" className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline underline-offset-2">
          탭바 순서 편집
        </Link>
      </p>
      {/* 메뉴가 열린 동안 페이지·탭바를 어둡게(들린 칸과 메뉴만 위에). 누르면 Popover 바깥 누름으로 닫힌다. */}
      {menuFor && <div data-testid="apps-scrim" aria-hidden className="fixed inset-0 z-40 bg-black/35 animate-in fade-in duration-150" />}
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  )
}
