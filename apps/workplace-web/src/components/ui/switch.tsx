"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  // WP-935: 꺼짐(unchecked)은 연한 트랙(bg-input)에 테두리(switch-off-border)를 둘러 흰 카드 위에서도 경계가 3:1 로 보이게 한다.
  // data-* 변형이 focus-visible 보다 뒤에 정렬돼 초점 테두리(border-ring)를 덮으므로, 꺼짐+초점 조합을 따로 border-ring 으로 되돌린다.
  // 켜짐은 기존 그대로(투명 테두리 1px 이라 레이아웃 변화 없음). 비활성은 opacity-50 로 테두리까지 흐려져 「그냥 꺼짐」과 구분된다.
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:border-switch-off-border focus-visible:data-[state=unchecked]:border-ring focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:bg-foreground pointer-events-none block rounded-full ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
