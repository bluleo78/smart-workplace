// 막힌 버튼 + 이유 툴팁 — disabled 버튼은 포인터·포커스 이벤트를 받지 않아 툴팁을 띄우지 못하므로,
// 포커스 가능한 span 으로 감싸 그 span 이 툴팁을 띄운다(키보드 포커스에도 이유가 보이게).
// 상태 「+ 추가」 상한처럼 「왜 못 누르는지」를 같은 모양으로 보이는 곳이 함께 쓴다.
// WP-1852: reason 이 null 이면 같은 span 을 Tab 정지·이름·툴팁 없이 그대로 두어, 버튼이 막혔다 풀려도
//   감싸개·버튼 DOM 이 다시 만들어지지 않게 하고, reason 이 생기고 사라질 때 초점을 버튼 ↔ 감싸개로 넘긴다.
import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'

import { FOCUSABLE } from '@/hooks/useDialogFocusRestore'
import { focusLost } from '@/hooks/useRestoreFocusOnExit'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** 그 요소가 키보드 초점(:focus-visible)인지 — 마우스 클릭 초점에는 툴팁·초점 이동을 하지 않으려는 판정. 지원 안 하면 false(옮기지 않음). */
function hasKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

export function DisabledReasonTooltip({
  reason,
  className,
  children,
  onFocusCapture,
  onBlurCapture,
  onPointerDownCapture,
  ...spanProps
}: { reason: string | null; children: ReactNode } & Omit<ComponentProps<'span'>, 'children'>) {
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

  const span = (
    <span
      ref={spanRef}
      {...spanProps}
      onFocusCapture={(e) => {
        keyboardFocus.current = hasKeyboardFocus(e.target as Element)
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
      aria-label={reason != null ? spanProps['aria-label'] : undefined}
      className={cn(
        'inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {children}
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
