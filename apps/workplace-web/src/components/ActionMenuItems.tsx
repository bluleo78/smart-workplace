// 행 작업 목록(MobileSheetAction[])을 드롭다운 메뉴 항목으로 그린다 — 터치 태블릿 ⋯(TouchRowActionsMenu)와
// 데스크톱 드라이브 행 ⋯(RowOverflowMenu)가 함께 써서 항목 모양·구분선이 어긋나지 않게 한다(WP-363).
import { Fragment } from 'react'

import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/overlay/dropdown-menu'
import { startsDestructiveGroup } from '@/lib/startsDestructiveGroup'

/** DropdownMenuContent 안에 넣는 항목 묶음. 파괴적 항목은 구분선 아래 빨간 글자로 둔다. */
export function ActionMenuItems({
  actions,
  itemTestId,
}: {
  actions: MobileSheetAction[]
  /** 항목 testid — 생략하면 달지 않는다. */
  itemTestId?: (key: string) => string
}) {
  return actions.map((a, i) => (
    <Fragment key={a.key}>
      {startsDestructiveGroup(actions, i) && <DropdownMenuSeparator />}
      <DropdownMenuItem
        data-testid={itemTestId?.(a.key)}
        variant={a.destructive ? 'destructive' : 'default'}
        disabled={a.disabled}
        onSelect={a.onSelect}
      >
        {a.icon}
        {a.label}
      </DropdownMenuItem>
    </Fragment>
  ))
}
