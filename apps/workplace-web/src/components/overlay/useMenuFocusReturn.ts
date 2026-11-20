// 포털 메뉴(DropdownMenu)를 닫을 때 초점을 연 요소로 돌려주는 훅 (WP-1778).
//
// 왜 필요한가: 이슈 행·카드 메뉴와 줄 링크 메뉴는 Radix 트리거가 보이지 않는 0 크기 앵커라
// Radix 기본 복귀(트리거로 초점)를 쓸 수 없다 — 앵커로 초점을 보내면 행 자리로 화면이 튄다. 그래서
// onCloseAutoFocus 를 막아 왔고, 그 결과 Esc·바깥 클릭으로 닫으면 초점이 body 로 사라졌다(WCAG 2.4.3).
// 또 메뉴 항목이 연 입력기·대화상자의 초점을 빼앗아서도 안 되므로, "닫힌 뒤 아무도 초점을 가져가지 않았을 때만" 돌려준다.
// 우클릭(초점이 안 움직임)·Safari(단추 클릭이 초점을 안 줌)에서는 열 때의 activeElement 가 검색 입력 같은 엉뚱한 요소일 수 있어,
// 메뉴를 연 행·단추(origin) 안의 요소일 때만 그대로 돌려주고 아니면 origin 의 ⋯ 단추(없으면 origin)로 보낸다.
// 진짜 트리거가 있는 메뉴(보드 컬럼 ⋯ 등)는 이 훅이 필요 없다 — onCloseAutoFocus 를 막지 않으면 Radix 가 트리거로 돌려준다.
import { useState } from 'react'

import { FOCUSABLE } from '@/hooks/useDialogFocusRestore'
import { focusLost } from '@/hooks/useRestoreFocusOnExit'

/** 메뉴를 열 때 붙잡아 두는 값 — 닫힘 재렌더에서는 호출부 상태(예: 메뉴 대상)가 비어 origin prop 이 사라질 수 있다. */
interface OpenedAt {
  /** 열 때 초점이 있던 요소 */
  remembered: HTMLElement | null
  /** 메뉴를 연 행·카드·줄 또는 ⋯ 단추 */
  origin: HTMLElement | null
}

/**
 * 메뉴가 열릴 때 초점이 있던 요소를 기억했다가, 닫힌 뒤 초점이 비어 있으면 돌려준다(후보 순서는 focusCandidates).
 * DropdownMenuContent 의 onCloseAutoFocus 에 반환값을 그대로 넘긴다.
 *
 * @param open 메뉴가 열려 있는지(열린 동안만 그리는 메뉴는 true)
 * @param origin 메뉴를 연 요소(행·카드·줄 또는 ⋯ 단추). 열 때의 값을 쓴다.
 */
export function useMenuFocusReturn(open: boolean, origin?: HTMLElement | null): { onCloseAutoFocus: (e: Event) => void } {
  // 직전 렌더의 open — 첫 렌더가 이미 open 이어도 "열림 전환"으로 보도록 false 로 시작한다.
  const [prevOpen, setPrevOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState<OpenedAt>({ remembered: null, origin: null })

  // 렌더 중에 전환을 감지한다(「이전 prop 저장」 패턴). effect 는 Radix 가 초점을 메뉴 안으로 옮긴 뒤에
  // 돌 수 있어 그때는 이미 늦기 때문이다. 열린 동안의 재렌더는 prevOpen 이 true 라 덮어쓰지 않는다.
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      const active = document.activeElement
      setOpenedAt({
        remembered: active instanceof HTMLElement && active !== document.body ? active : null,
        origin: origin ?? null,
      })
    }
  }

  const onCloseAutoFocus = (e: Event) => {
    // Radix 기본 복귀(0 크기 앵커로 초점)는 막는다.
    e.preventDefault()
    // 항목이 연 입력기·대화상자는 다음 프레임 안에 초점을 가져가므로 한 프레임 기다린 뒤 본다.
    requestAnimationFrame(() => {
      if (!focusLost()) return
      for (const el of focusCandidates(openedAt.remembered, openedAt.origin)) {
        // tabindex 없는 div 같은 요소는 건너뛴다 — 브라우저는 focus() 를 무시하지만 jsdom 은 초점을 줘 버려
        // 테스트에서 실제 동작과 어긋나므로, 브라우저가 초점을 주는 요소인지 먼저 본다.
        if (!el.isConnected || !(el.hasAttribute('tabindex') || el.matches(FOCUSABLE))) continue
        // 화면이 행으로 튀지 않게 스크롤 없이. 숨은 ⋯ 처럼 그래도 초점을 못 받으면 다음 후보로 넘어간다.
        el.focus({ preventScroll: true })
        if (document.activeElement === el) return
      }
    })
  }

  return { onCloseAutoFocus }
}

/**
 * 초점을 돌려줄 후보를 우선순위대로 낸다(뒤 후보의 DOM 조회는 앞 후보가 실패할 때만 한다).
 * origin 이 없으면 기억한 요소만. 있으면: 기억한 요소(origin 안일 때) → origin 의 ⋯ 단추 → origin → origin 안 첫 초점 가능 요소
 * → origin 밖의 기억한 요소(예전 동작 — origin 에 초점 받을 곳이 전혀 없을 때만).
 */
function* focusCandidates(remembered: HTMLElement | null, origin: HTMLElement | null): Generator<HTMLElement> {
  if (!origin) {
    if (remembered) yield remembered
    return
  }
  const inside = remembered !== null && origin.contains(remembered)
  if (inside) yield remembered
  const more = origin.querySelector<HTMLElement>('[aria-haspopup="menu"]')
  if (more) yield more
  yield origin
  const first = origin.querySelector<HTMLElement>(FOCUSABLE)
  if (first) yield first
  if (remembered && !inside) yield remembered
}
