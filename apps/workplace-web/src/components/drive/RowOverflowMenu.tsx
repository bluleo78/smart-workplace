// apps/workplace-web/src/components/drive/RowOverflowMenu.tsx
import { MoreHorizontal } from 'lucide-react'

import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/** ⋯ 더보기 항목. destructive 는 삭제류 위험 액션 강조. */
export interface RowOverflowItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

/**
 * 파일 행의 부차 액션(버전 이력·이동·복사 등)을 담는 ⋯ 더보기 메뉴.
 * 인라인 버튼 수를 줄여 행 밀도를 낮춘다. 항목이 없으면 렌더하지 않는다.
 */
export function RowOverflowMenu({
  items,
  triggerAriaLabel,
}: {
  items: RowOverflowItem[]
  triggerAriaLabel: string
}) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={triggerAriaLabel}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {items.map((it) => (
          <DropdownMenuItem
            key={it.label}
            disabled={it.disabled}
            onSelect={it.onSelect}
            className={it.destructive ? 'text-destructive focus:text-destructive' : undefined}
          >
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
