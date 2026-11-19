// 사람 카드 트리거(WP-1767) — 이름·아바타(children)를 누르면 카드를 연다. 데스크톱은 팝오버, 모바일은 아래 시트.
//  - 누를 때만 연다(호버로 열지 않음). 바깥 누르기·Esc 로 닫히고, 닫히면 포커스는 트리거로 돌아온다.
//  - 트리거·카드 안 클릭·키는 위로 올리지 않는다(코멘트 행·고르기 버튼이 같이 눌리지 않게). 카드 틀의 onKeyDown 은 Radix 가 사용자 처리기 → FocusScope
//    처리기 차례로 합쳐 부르므로(Slot mergeProps) 여기서 전파를 막아도 Tab 순환은 그대로다. 카드 안쪽(PersonCardBody)에서 막으면 FocusScope 가 못 받는다.
//  - 카드 안 pointerup 도 막는다 — 이슈 챗 행의 터치 툴바 드러내기(useToolbarReveal 의 onPointerUp)가 카드 탭에 반응하지 않게.
//    pointerdown 은 막지 않는다 — React 의 전파 막기는 document 까지 막아, Radix DismissableLayer 가 「안쪽 누름」 표식을 못 지워 다음 바깥 누르기가 무시된다.
import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

import { PersonCardBody } from './PersonCardBody'
import type { PersonRef } from './usePersonCard'

const stop = (e: SyntheticEvent) => e.stopPropagation()
// 카드 틀(팝오버·시트 공통)이 막는 이벤트 — 포털 안 클릭·키·pointerup 이 React 조상으로 올라가지 않게.
const STOP_PROPS = { onClick: stop, onKeyDown: stop, onPointerUp: stop }

export function PersonCardTrigger({
  person,
  className,
  label,
  children,
}: {
  person: PersonRef
  className?: string
  /** 트리거의 접근 이름 — 안쪽 글자 대신 읽힌다. AI 처럼 이름만으로 모자랄 때 준다(예: 「리뷰봇 (에이전트)」). 없으면 안쪽 글자. */
  label?: string
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="dialog"
      aria-label={label}
      aria-expanded={open}
      data-testid={`person-card-trigger-${person.id}`}
      className={cn('cursor-pointer rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}
      onKeyDown={stop}
      onClick={(e) => {
        stop(e)
        if (isMobile) setOpen(true)
      }}
    >
      {children}
    </button>
  )
  // 열림 여부로 감싸지 않는다 — 닫힘 애니메이션 동안 내용이 유지된다. Radix 가 닫힌 내용은 마운트하지 않으므로 요청은 열렸을 때만 간다.
  const body = <PersonCardBody person={person} onClose={() => setOpen(false)} />

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            data-testid="person-card-sheet"
            className="max-h-[85dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
            {...STOP_PROPS}
            // 트리거 없는 시트라 포커스 복귀를 직접 한다.
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              triggerRef.current?.focus()
            }}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" />
            <SheetTitle className="sr-only">{person.name}</SheetTitle>
            <SheetDescription className="sr-only">{person.name} 프로필과 작업</SheetDescription>
            {body}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" role="dialog" aria-label={`${person.name} 카드`} {...STOP_PROPS}>
        {body}
      </PopoverContent>
    </Popover>
  )
}
