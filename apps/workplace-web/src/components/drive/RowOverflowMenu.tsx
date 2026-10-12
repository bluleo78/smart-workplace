// apps/workplace-web/src/components/drive/RowOverflowMenu.tsx
import { MoreHorizontal } from 'lucide-react'

import { ActionMenuItems } from '@/components/ActionMenuItems'
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** 데스크톱 드라이브 행 hover 묶음 끝의 ⋯ 더보기 메뉴 — 인라인으로 꺼내지 않은 행 작업을 담는다. */
export function RowOverflowMenu({
  items,
  triggerAriaLabel,
}: {
  items: MobileSheetAction[]
  triggerAriaLabel: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={triggerAriaLabel}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <ActionMenuItems actions={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
