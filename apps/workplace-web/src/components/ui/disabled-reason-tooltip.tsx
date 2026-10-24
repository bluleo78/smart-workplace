// 막힌 버튼 + 이유 툴팁 — disabled 버튼은 포인터·포커스 이벤트를 받지 않아 툴팁을 띄우지 못하므로,
// 포커스 가능한 span 으로 감싸 그 span 이 툴팁을 띄운다(키보드 포커스에도 이유가 보이게).
// 상태 「+ 추가」 상한처럼 「왜 못 누르는지」를 같은 모양으로 보이는 곳이 함께 쓴다.
import type { ComponentProps, ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function DisabledReasonTooltip({
  reason,
  className,
  children,
  ...spanProps
}: { reason: string; children: ReactNode } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    // 앱 루트에 툴팁 공급자가 없어 직접 감싼다 — 바깥 공급자 안에 있어도 중첩은 문제없다.
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              className,
            )}
            {...spanProps}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
