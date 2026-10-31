// shadcn HoverCard 래퍼 — 마우스를 올리면 뜨는 상호작용 가능한 카드(툴팁과 달리 안의 버튼을 누를 수 있다).
// Radix HoverCard 는 터치 포인터로는 열리지 않는다 — 모바일은 길게 누르기 등 별도 경로를 쓴다.
import * as React from "react"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** 앱 공용 호버 카드 열림 지연 — 칩·링크 위를 스쳐 지나갈 때마다 카드가 번쩍이거나 요청하지 않게(반응 칩·본문 이슈 키 링크). */
export const HOVER_OPEN_DELAY_MS = 300
/** 닫힘 지연 — 트리거에서 카드로 마우스를 옮기는 동안 유지(카드 안 버튼을 누를 수 있게). */
export const HOVER_CLOSE_DELAY_MS = 150

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger(props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 w-64 rounded-md border p-3 shadow-md outline-hidden",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
