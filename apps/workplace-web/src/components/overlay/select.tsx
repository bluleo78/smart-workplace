// 앱 공용 Select — shadcn ui/select 를 그대로 내보내되 Select(열 때 배치 고정)·SelectContent(탭바 피하기)만 감싼다(WP-806).
// 왜 감싸나: overlay/popover.tsx 머리말과 같다(ui/* 직접 수정 금지·뒤집기는 숫자 충돌 여백으로만 가능).
import { type ComponentProps, createContext, useContext, useState } from 'react'

import { Select as UiSelect, SelectContent as UiSelectContent } from '@/components/ui/select'
import { useMobileTabBarHeight, withTabBarCollisionPadding } from '@/lib/mobileTabBar'

export {
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Radix Select popper 의 기본 충돌 여백(CONTENT_MARGIN) — 여백을 넘기면 기본값이 사라지므로 같은 값에서 출발한다.
const SELECT_DEFAULT_COLLISION_PADDING = 10

// 목록을 열 때 탭바가 보였는가 — Select 가 열림 이벤트에서 찍어 SelectContent 에 넘긴다. null = 아직 연 적 없음(지금 값을 쓴다).
const OpenedWithTabBarContext = createContext<boolean | null>(null)

/**
 * 선택 창 루트 — 열리는 순간의 탭바 유무를 찍어 둔다.
 * 왜: 배치(popper/item-aligned)를 탭바 높이의 현재 값으로 고르면, 열린 채로 탭바가 나타나거나 사라질 때 배치가 바뀌어
 * Radix 가 목록을 다시 마운트한다(스크롤·포커스가 날아감). 열 때 정한 배치를 닫을 때까지 유지한다.
 * 열림을 부모가 open 으로만 바꾸면(onOpenChange 없이) 찍을 기회가 없어 지금 값을 쓴다.
 */
export function Select({ onOpenChange, ...props }: ComponentProps<typeof UiSelect>) {
  const tabBar = useMobileTabBarHeight()
  const [openedWithTabBar, setOpenedWithTabBar] = useState<boolean | null>(null)
  const handleOpenChange = (open: boolean) => {
    if (open) setOpenedWithTabBar(tabBar > 0)
    onOpenChange?.(open)
  }
  return (
    <OpenedWithTabBarContext.Provider value={openedWithTabBar}>
      <UiSelect onOpenChange={handleOpenChange} {...props} />
    </OpenedWithTabBarContext.Provider>
  )
}

/**
 * 선택 창 내용 — 모바일 하단 탭바가 보이면 트리거 아래(popper)에 펼치고 탭바를 화면 아래 끝처럼 피한다.
 * 왜 popper 로 바꾸나: 기본 배치(item-aligned)는 충돌 여백을 쓰지 않고 창 끝(10px)까지 펼쳐, 화면 아래쪽 칸에서 연 목록이
 * 탭바 자리까지 내려왔다. 탭바가 없으면(데스크톱·상세 화면) 호출부가 고른 배치 그대로다.
 * 배치는 열 때 찍은 값(Select)으로 고르고, 충돌 여백은 지금 값을 쓴다(여백이 바뀌면 위치만 다시 잡힌다).
 */
export function SelectContent({ position, collisionPadding, ...props }: ComponentProps<typeof UiSelectContent>) {
  const tabBar = useMobileTabBarHeight()
  const withTabBar = useContext(OpenedWithTabBarContext) ?? tabBar > 0
  return (
    <UiSelectContent
      position={position ?? (withTabBar ? 'popper' : undefined)}
      collisionPadding={withTabBarCollisionPadding(collisionPadding, tabBar, SELECT_DEFAULT_COLLISION_PADDING)}
      {...props}
    />
  )
}
