// 모바일 헤더 ⋯ 메뉴(U1-2) — 페이지 actions(임의 ReactNode)를 세로 목록으로 담는 패널.
// Radix DropdownMenu 대신 직접 구현한 이유:
//  1) actions 안의 검색 입력(메일·드라이브)에 DropdownMenu typeahead 가 키 입력을 가로챈다.
//  2) 패널을 닫아도 내용을 언마운트하지 않아야 한다 — 드라이브 업로드처럼 actions 안의 숨은 <input type=file> 이
//     파일 선택 중에 사라지면 onChange 가 오지 않고, 액션이 소유한 다이얼로그 상태도 함께 사라진다.
// 그래서 패널은 항상 마운트해 두고 열림 여부만 CSS 로 전환한다(닫힌 동안은 display:none → 보이지도 눌리지도 않음).
import { MoreHorizontal } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

// 패널 안 버튼·링크를 메뉴 항목처럼 — 전폭·좌측 정렬·44px 높이·아이콘과 글자 가로 배치, 배경/테두리 제거(주 버튼의 흰 글자는 전경색으로).
// 파괴적 항목(text-destructive)은 색을 유지한다.
const panelClass = cn(
  'absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
  '[&_a]:w-full [&_input]:w-full [&_select]:w-full',
  '[&_button]:flex [&_button]:min-h-11 [&_button]:w-full [&_button]:items-center [&_button]:gap-2 [&_button]:justify-start [&_button]:rounded-sm [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-left [&_button]:text-sm [&_button]:text-foreground [&_button]:shadow-none',
  '[&_button:hover]:bg-accent [&_.text-destructive]:text-destructive',
)

export function MobileHeaderMore({
  children,
  icon,
  label = '더보기',
}: {
  children: ReactNode
  /** 트리거 아이콘(기본 ⋯). 메일처럼 메뉴가 검색 하나뿐이면 🔍 로 바꿔 의미를 드러낸다. */
  icon?: ReactNode
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 열린 동안만 바깥 누름·Esc 로 닫는다. 메뉴에서 연 다이얼로그(포털)를 누르는 것도 "바깥"이지만 그땐 이미 닫혀 있다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-testid="mobile-header-more"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center text-muted-foreground"
      >
        {icon ?? <MoreHorizontal className="h-5 w-5" />}
      </button>
      <div
        data-testid="mobile-header-more-menu"
        // 항목(버튼·링크)을 누르면 닫는다 — 입력·선택 상자는 조작 중이므로 닫지 않는다.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) setOpen(false)
        }}
        className={cn(panelClass, open ? 'flex' : 'hidden')}
      >
        {children}
      </div>
    </div>
  )
}
