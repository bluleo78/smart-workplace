// 앱 목록 길게 누르기 액션 메뉴(WP-121) — 한 앱에 대한 탭바 고정·교체·열기.
// 메뉴 단계(step)를 스스로 가진다. 부모는 열린 앱의 메뉴만 렌더하므로(PopoverContent 가 열릴 때만 마운트)
// 닫았다 다시 열면 자연히 첫 단계부터 시작한다.
import { ArrowUpRight, type LucideIcon, Pin, Replace } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { ALL_TAB_IDS, MOBILE_TABS, type MobileTabId } from '@/lib/mobile/tabs'

/** 메뉴 단계 — 첫 화면 / (미고정 앱) 바꿀 탭 선택 / (고정 앱) 교체할 앱 선택. */
type MenuStep = 'menu' | 'replace' | 'swap'

/** 메뉴 한 줄 — 44px 터치 타깃, 아이콘 + 글자. */
function MenuItem({ testId, icon: Icon, onClick, children }: {
  testId: string
  icon: LucideIcon
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent"
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  )
}

/** 탭 id 로 그 탭의 아이콘·라벨을 그리는 메뉴 한 줄(교체 대상·교체 후보 목록 공용). */
function TabMenuItem({ testId, tab, suffix, onClick }: {
  testId: string
  tab: MobileTabId
  suffix?: string
  onClick: () => void
}) {
  const t = MOBILE_TABS[tab]
  return (
    <MenuItem testId={testId} icon={t.icon} onClick={onClick}>
      {t.label}{suffix}
    </MenuItem>
  )
}

/** 단계 머리말(작은 회색 글자). */
function MenuCaption({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">{children}</p>
}

export function AppActionMenu({ id, slots, onReplace, onOpen }: {
  id: MobileTabId
  slots: MobileTabId[]
  /** from 칸을 to 앱으로 제자리 교체. */
  onReplace: (from: MobileTabId, to: MobileTabId) => void
  /** 앱 열기(메뉴 닫고 이동). */
  onOpen: () => void
}) {
  const [step, setStep] = useState<MenuStep>('menu')
  const t = MOBILE_TABS[id]

  if (step === 'replace') {
    // 탭바 3칸은 항상 차 있으므로 고정 = 기존 칸 하나와 교체.
    return (
      <>
        <MenuCaption>탭바가 꽉 찼어요 — 바꿀 탭 선택</MenuCaption>
        {slots.map((slotId) => (
          <TabMenuItem key={slotId} testId={`apps-replace-${slotId}`} tab={slotId} suffix=" 대신" onClick={() => onReplace(slotId, id)} />
        ))}
      </>
    )
  }
  if (step === 'swap') {
    // 이 칸에 대신 넣을 수 있는 앱 = 탭바에 없는 앱.
    const candidates = ALL_TAB_IDS.filter((x) => !slots.includes(x))
    return (
      <>
        <MenuCaption>{t.label} 대신 넣을 앱</MenuCaption>
        <div className="max-h-64 overflow-y-auto">
          {candidates.map((c) => (
            <TabMenuItem key={c} testId={`apps-swap-to-${c}`} tab={c} onClick={() => onReplace(id, c)} />
          ))}
        </div>
      </>
    )
  }
  return (
    <>
      <MenuCaption>{t.label}</MenuCaption>
      {slots.includes(id) ? (
        <MenuItem testId="apps-swap" icon={Replace} onClick={() => setStep('swap')}>다른 앱으로 교체</MenuItem>
      ) : (
        <MenuItem testId="apps-pin" icon={Pin} onClick={() => setStep('replace')}>탭바에 고정</MenuItem>
      )}
      <MenuItem testId="apps-open" icon={ArrowUpRight} onClick={onOpen}>열기</MenuItem>
    </>
  )
}
