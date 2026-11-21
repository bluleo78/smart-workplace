// 막힌 버튼 + 이유 툴팁 — disabled 버튼은 포인터·포커스 이벤트를 받지 않아 툴팁을 띄우지 못하므로,
// 포커스 가능한 span 으로 감싸 그 span 이 툴팁을 띄운다(키보드 포커스에도 이유가 보이게).
// 상태 「+ 추가」 상한처럼 「왜 못 누르는지」를 같은 모양으로 보이는 곳이 함께 쓴다.
// WP-1852: reason 이 null 이면 같은 span 을 Tab 정지·이름·툴팁 없이 그대로 두어, 버튼이 막혔다 풀려도
//   감싸개·버튼 DOM 이 다시 만들어지지 않게 하고, reason 이 생기고 사라질 때 초점을 버튼 ↔ 감싸개로 넘긴다.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'

import { DISABLED_REASON_WRAPPER_ATTR, FOCUSABLE } from '@/hooks/useDialogFocusRestore'
import { focusLost, isKeyboardFocused } from '@/hooks/useRestoreFocusOnExit'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'


export function DisabledReasonTooltip({
  reason,
  label,
  className,
  children,
  onFocusCapture,
  onBlurCapture,
  onPointerDownCapture,
  ...spanProps
}: {
  reason: string | null
  /** 컨트롤 이름 — 주면 막혔을 때 이름이 `<label> — <reason>` 이 된다. 명시한 aria-label 이 있으면 그것이 이긴다. */
  label?: string
  children: ReactNode
} & Omit<ComponentProps<'span'>, 'children'>) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const prevReason = useRef<string | null>(reason)
  const [open, setOpen] = useState(false)
  // 안의 요소가 「키보드로」 초점을 받아 아직 쥐고 있는지 — 막히는 순간에는 버튼이 이미 disabled 라 :focus-visible 이 거짓이 되므로
  // 초점을 받는 때에 미리 재어 둔다. 마우스 누름이나 초점을 잃는 blur 가 오면 거짓으로 되돌린다.
  const keyboardFocus = useRef(false)

  // useLayoutEffect 인 까닭: 브라우저는 버튼이 disabled 가 되면 그 초점을 body 로 고쳐 버린다.
  // 그 전(페인트 전)에 초점을 감싸개로 옮겨야 키보드 사용자가 자리를 잃지 않는다.
  useLayoutEffect(() => {
    const span = spanRef.current
    const prev = prevReason.current
    prevReason.current = reason
    if (!span) return
    const active = document.activeElement
    if (prev == null && reason != null) {
      // 막히는 순간: 키보드 초점이 안의 버튼에 있었다면 감싸개로 옮긴다. 마우스 클릭 초점이면 그대로 둔다(툴팁이 튀지 않게).
      const stillInside = active != null && active !== span && span.contains(active)
      // 브라우저가 버튼을 막으며 초점을 이미 body 로 떨어뜨린 경우(그 blur 이벤트는 이 효과보다 늦게 온다).
      if ((stillInside || focusLost()) && keyboardFocus.current) span.focus()
    } else if (prev != null && reason == null) {
      // 풀리는 순간: 열려 있던 툴팁 상태를 닫는다 — reason 이 없는 동안은 onOpenChange 가 없어 blur 로도 닫히지 않으므로,
      // 여기서 닫지 않으면 다음에 reason 이 생길 때(마우스 클릭·예약 실행) 호버·초점 없이 툴팁이 저절로 뜬다.
      setOpen(false)
      // 초점이 감싸개에 있었다면 안의 버튼으로 돌려준다(감싸개는 Tab 정지가 아니게 된다).
      // 초점 받을 요소가 없으면 옮기지 않는다.
      if (active === span) span.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }
  }, [reason])

  // 막혔을 때의 접근 가능한 이름 — 호출자가 명시한 aria-label 이 이기고, 없으면 `label — reason`. reason 이 없으면 없음.
  const accessibleName =
    reason != null ? (spanProps['aria-label'] ?? (label ? `${label} — ${reason}` : undefined)) : undefined

  const span = (
    <span
      ref={spanRef}
      {...spanProps}
      // 감싸개 표지 — 초점 복원이 막힌 트리거의 부모 중 이 감싸개만 골라 초점을 옮기게 한다.
      {...{ [DISABLED_REASON_WRAPPER_ATTR]: '' }}
      onFocusCapture={(e) => {
        keyboardFocus.current = isKeyboardFocused(e.target as Element)
        onFocusCapture?.(e)
      }}
      onBlurCapture={(e) => {
        // 초점이 감싸개 밖으로 나가면 더는 키보드 초점을 쥐고 있지 않다(안에서 안으로 옮기는 중이면 유지).
        if (!spanRef.current?.contains(e.relatedTarget as Node | null)) keyboardFocus.current = false
        onBlurCapture?.(e)
      }}
      onPointerDownCapture={(e) => {
        keyboardFocus.current = false
        onPointerDownCapture?.(e)
      }}
      // reason 이 없으면 호출자가 tabIndex 를 넘겨도 Tab 정지가 되지 않는다(-1). 있을 때만 호출자 값이 이기고 기본은 0.
      // -1 로 남기는 까닭: tabindex 를 아예 지우면 브라우저(Chromium)가 그 순간(커밋 중) 감싸개의 초점을 body 로 떨어뜨려,
      // 풀리는 순간의 위 효과가 「감싸개에 초점이 있었다」를 보지 못하고 모달 초점 가두기가 초점을 모달로 가져간다.
      // -1 은 Tab 순서에는 없고 초점만 쥘 수 있어 효과가 안의 버튼으로 넘겨줄 때까지 초점이 남는다.
      tabIndex={reason != null ? (spanProps.tabIndex ?? 0) : -1}
      // 이름은 호출자가 줄 때만 — 기본값을 reason 으로 두면 이름을 넘기지 않던 곳(상태 「+ 추가」·사람 카드 「메일」)의
      // 컨트롤 이름이 사유로 덮인다. reason 이 없으면 이름 없음.
      aria-label={accessibleName}
      // 역할 없는 span(generic)은 ARIA 상 이름을 붙일 수 없어 스크린리더가 aria-label 을 무시할 수 있다.
      // 그래서 이유가 있고 이름이 있는 동안만 button 역할 + aria-disabled 로 「막힌 버튼」 하나로 노출한다.
      // 이름이 없으면(이름 없이 쓰던 호출자) 지금처럼 역할을 달지 않는다. reason 이 없으면 역할도 없어 안의 진짜 버튼이 그대로 노출된다.
      role={accessibleName ? 'button' : spanProps.role}
      aria-disabled={accessibleName ? true : spanProps['aria-disabled']}
      className={cn(
        'inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {/* 막혀 이름을 가진 동안은 안쪽을 inert 로 막는다 — 보조기기에서 숨기고(감싸개가 버튼 하나로 읽힌다) 초점·클릭도 막아,
          aria-disabled + tabIndex -1 로 남은 안의 단추가 숨겨진 채 초점을 받는 일이 없다. 클릭·호버는 감싸개로 간다.
          reason 이 바뀌어도 같은 노드를 두고 속성만 바꾸어 다시 만들어지지 않게 한다. 안쪽 칸은 감싸개 폭을 채워(flex) 배치를 그대로 둔다. */}
      <span className="flex min-w-0 flex-1" inert={accessibleName ? true : undefined}>
        {children}
      </span>
    </span>
  )

  // 같은 트리 모양을 유지해야 reason 이 바뀌어도 span 이 다시 만들어지지 않는다 — 항상 Tooltip 으로 감싸고
  // 내용만 reason 이 있을 때 둔다. Tooltip 은 늘 제어 모드(제어/비제어가 바뀌면 Radix 가 경고한다):
  // reason 이 없으면 닫힘으로 눌러 두어 호버·초점이 열림 상태·aria-describedby 를 남기지 않는다.
  return (
    // 앱 루트에 툴팁 공급자가 없어 직접 감싼다 — 바깥 공급자 안에 있어도 중첩은 문제없다.
    <TooltipProvider>
      <Tooltip open={reason != null && open} onOpenChange={reason != null ? setOpen : undefined}>
        <TooltipTrigger asChild>{span}</TooltipTrigger>
        {reason != null && <TooltipContent>{reason}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  )
}
