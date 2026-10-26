// 글자 없는 아이콘의 이름 보기 — 마우스는 hover·키보드 포커스 툴팁, 터치(pointer: coarse)는 hover 가 없어 탭 팝오버로 보인다(WP-991).
// 관계 줄 상태 아이콘처럼 이름 글자를 빼고 아이콘만 남긴 곳이 쓴다. 아이콘 자체의 aria-label 은 그대로 두고 눈에 보이는 이름만 더한다.
import type { ReactNode } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'

export function IconHint({
  label,
  children,
  'data-testid': testId,
}: {
  /** 툴팁·팝오버에 보일 이름. */
  label: string
  /** 이름을 붙일 아이콘. */
  children: ReactNode
  'data-testid'?: string
}) {
  const isCoarse = useIsCoarsePointer()

  if (isCoarse) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          {/* 14px 아이콘만으론 옆 링크를 잘못 누르기 쉽다 — 음수 여백으로 줄 높이는 그대로 두고 탭 영역만 넓힌다(옆 간격 8px 안쪽). */}
          <button
            type="button"
            className="-my-2.5 -ml-1.5 -mr-1 flex shrink-0 items-center py-2.5 pl-1.5 pr-1"
            data-testid={testId}
          >
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto px-3 py-1.5 text-xs">{label}</PopoverContent>
      </Popover>
    )
  }

  return (
    // 앱 루트에 툴팁 공급자가 없어 직접 감싼다(DisabledReasonTooltip 과 같은 방식).
    // 목록을 훑는 마우스에 툴팁이 줄마다 번쩍이지 않게 IssueSidebar 와 같은 200ms 지연을 둔다.
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* 이름 글자가 없으므로 키보드로도 닿게 포커스를 받는다(포커스 때 툴팁이 뜬다). */}
          <span
            tabIndex={0}
            className="flex shrink-0 items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid={testId}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
