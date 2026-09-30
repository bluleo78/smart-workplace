// 모바일 헤더 ⋯ 메뉴(U1-2) — 페이지 actions(임의 ReactNode)를 세로 목록으로 담는 패널.
// Radix DropdownMenu 대신 직접 구현한 이유:
//  1) actions 안의 검색 입력(메일·드라이브)에 DropdownMenu typeahead 가 키 입력을 가로챈다.
//  2) 패널을 닫아도 내용을 언마운트하지 않아야 한다 — 드라이브 업로드처럼 actions 안의 숨은 <input type=file> 이
//     파일 선택 중에 사라지면 onChange 가 오지 않고, 액션이 소유한 다이얼로그 상태도 함께 사라진다.
// 그래서 패널은 항상 마운트해 두고 열림 여부만 CSS 로 전환한다(닫힌 동안은 display:none → 보이지도 눌리지도 않음).
// 키보드(U2-9·U3-R13): 키보드(Enter/Space)로 열었을 때만 첫 항목에 포커스(터치·클릭으로 열면 포커스 링을 띄우지 않음),
// ↑↓ 로 항목 이동(입력·선택 상자 안에선 가로채지 않음), Esc 는 닫고 트리거로 포커스 복귀. 항목은 role="menuitem".
// 항목이 하나뿐이면(U3-R7) ⋯ 를 두지 않고 그 항목을 헤더에 바로 둔다 — 한 번 더 누르게 하는 메뉴는 이득이 없다.
import { MoreHorizontal } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/utils'

// 화살표 이동 대상 = 메뉴 항목(버튼·링크). 입력·선택 상자는 자체 키 조작이 있어 제외한다.
const ITEM_SELECTOR = 'button:not(:disabled), a[href]'
// 한 항목 판정용 — 비활성 항목도 항목이다(권한 로딩 등으로 잠시 비활성인 버튼이 있으면 메뉴로 둔다).
const ANY_ITEM_SELECTOR = 'button, a[href]'
// 이 요소 안에서 누른 화살표는 입력 조작(커서·옵션 이동)이므로 메뉴가 가로채지 않는다.
const isTextControl = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, select, textarea') !== null

// 패널 안 버튼·링크를 메뉴 항목처럼 — 전폭·좌측 정렬·44px 높이·아이콘과 글자 가로 배치, 배경/테두리 제거(주 버튼의 흰 글자는 전경색으로).
// 링크(Button asChild + Link 등)도 버튼과 같은 모양이어야 해서 두 요소에 같은 규칙을 준다(U3-C3).
// 파괴적 항목(text-destructive)은 색을 유지한다.
const panelClass = cn(
  'absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
  '[&_input]:w-full [&_select]:w-full',
  '[&_:is(button,a)]:flex [&_:is(button,a)]:min-h-11 [&_:is(button,a)]:w-full [&_:is(button,a)]:items-center [&_:is(button,a)]:gap-2 [&_:is(button,a)]:justify-start [&_:is(button,a)]:rounded-sm [&_:is(button,a)]:border-0 [&_:is(button,a)]:bg-transparent [&_:is(button,a)]:px-3 [&_:is(button,a)]:text-left [&_:is(button,a)]:text-sm [&_:is(button,a)]:text-foreground [&_:is(button,a)]:shadow-none',
  '[&_:is(button,a):hover]:bg-accent [&_.text-destructive]:text-destructive',
)

// 한 항목 인라인(R7) — 헤더 우측 텍스트 액션(탭 편집 [저장]과 같은 무게). 원래 버튼의 채움·테두리는 걷어낸다.
const inlineClass = cn(
  'flex items-center',
  '[&_:is(button,a)]:flex [&_:is(button,a)]:h-11 [&_:is(button,a)]:items-center [&_:is(button,a)]:gap-1 [&_:is(button,a)]:whitespace-nowrap [&_:is(button,a)]:rounded-md [&_:is(button,a)]:border-0 [&_:is(button,a)]:bg-transparent [&_:is(button,a)]:px-3 [&_:is(button,a)]:text-[15px] [&_:is(button,a)]:font-semibold [&_:is(button,a)]:text-primary [&_:is(button,a)]:shadow-none',
  '[&_:is(button,a):disabled]:text-muted-foreground [&_.text-destructive]:text-destructive',
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
  // 키보드로 열었는가 — 그때만 첫 항목에 포커스한다(R13).
  const [viaKeyboard, setViaKeyboard] = useState(false)
  // 항목이 하나뿐이라 메뉴 없이 헤더에 바로 두는가(R7).
  const [inline, setInline] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])

  // 항목 수 판정 + 메뉴 항목 role 부여. 페인트 전(layout effect)에 해서 ⋯ 가 잠깐 보였다 사라지지 않게 한다.
  // 자식 컴포넌트가 스스로 항목을 늘리거나 줄이면(권한 로딩 등) 이 컴포넌트는 재렌더되지 않으므로 MutationObserver 로도 다시 잰다.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measure = () => {
      const all = panel.querySelectorAll<HTMLElement>(ANY_ITEM_SELECTOR)
      // 입력·선택 상자가 있으면(메일 🔍 검색, 드라이브 숨은 파일 입력) 메뉴로 둔다 — 그 자체가 메뉴의 내용이다.
      const single = all.length === 1 && panel.querySelector('input, select, textarea') === null
      setInline(single)
      // 메뉴 모드일 때만 메뉴 의미를 준다. 눌림 상태(aria-pressed)가 있는 토글은 체크 항목으로 알린다.
      all.forEach((el) => {
        if (single) {
          el.removeAttribute('role')
          return
        }
        const pressed = el.getAttribute('aria-pressed')
        if (pressed != null) {
          el.setAttribute('role', 'menuitemcheckbox')
          el.setAttribute('aria-checked', pressed)
        } else {
          el.setAttribute('role', 'menuitem')
        }
      })
    }
    measure()
    const mo = new MutationObserver(measure)
    // aria-pressed 변화(구독 토글)도 aria-checked 로 따라가게 속성 변경까지 본다. 우리가 바꾸는 role/aria-checked 는 제외.
    mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled', 'href'] })
    return () => mo.disconnect()
  }, [])

  // 키보드로 열었으면 첫 항목으로 포커스 — 패널이 display:flex 로 바뀐 뒤(이펙트 시점)라 포커스가 먹는다.
  useEffect(() => {
    if (open && viaKeyboard) items()[0]?.focus()
  }, [open, viaKeyboard])

  // 열린 동안만 바깥 누름·Esc 로 닫는다. 메뉴에서 연 다이얼로그(포털)를 누르는 것도 "바깥"이지만 그땐 이미 닫혀 있다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // 키보드 사용자가 제자리(⋯ 버튼)로 돌아오게 한다.
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // ↑↓: 항목 사이 순환 이동. 입력·선택 상자 안의 화살표는 그 컨트롤의 동작으로 둔다.
  // React 합성 이벤트는 포털을 넘어 버블링된다 — 메뉴 항목이 연 다이얼로그(포털)의 화살표 키가 여기로 올라와
  // preventDefault 되지 않도록, 열린 동안 + 실제 DOM 상 패널 안에서 누른 키만 다룬다(U3-C2).
  const onPanelKey = (e: ReactKeyboardEvent) => {
    if (inline || !open || !panelRef.current?.contains(e.target as Node)) return
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTextControl(e.target)) return
    const list = items()
    if (list.length === 0) return
    e.preventDefault()
    const i = list.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
    list[next].focus()
  }

  return (
    <div ref={ref} className="relative flex shrink-0 items-center">
      {/* 한 항목 인라인이면 트리거를 두지 않는다. 자식 컨테이너는 같은 요소를 유지해(클래스만 전환) 액션 상태가 리셋되지 않는다. */}
      {!inline && (
        <button
          ref={triggerRef}
          type="button"
          data-testid="mobile-header-more"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            // detail === 0 — 포인터 없이 발생한 click(Enter/Space). 터치·마우스로 열면 포커스를 옮기지 않는다.
            setViaKeyboard(e.detail === 0)
            setOpen((o) => !o)
          }}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground"
        >
          {icon ?? <MoreHorizontal className="h-5 w-5" />}
        </button>
      )}
      <div
        ref={panelRef}
        data-testid={inline ? 'mobile-header-inline-action' : 'mobile-header-more-menu'}
        role={inline ? undefined : 'menu'}
        aria-label={inline ? undefined : label}
        onKeyDown={onPanelKey}
        // 항목(버튼·링크)을 누르면 닫는다 — 입력·선택 상자는 조작 중이므로 닫지 않는다.
        onClick={(e) => {
          if (!inline && (e.target as HTMLElement).closest('button, a')) setOpen(false)
        }}
        className={inline ? inlineClass : cn(panelClass, open ? 'flex' : 'hidden')}
      >
        {children}
      </div>
    </div>
  )
}
