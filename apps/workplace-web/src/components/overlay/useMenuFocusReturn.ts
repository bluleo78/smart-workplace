// 포털 메뉴(DropdownMenu)를 닫을 때 초점을 연 요소로 돌려주는 훅 (WP-1778).
//
// 왜 필요한가: 이슈 행·카드 메뉴와 줄 링크 메뉴는 Radix 트리거가 보이지 않는 0 크기 앵커라
// Radix 기본 복귀(트리거로 초점)를 쓸 수 없다 — 앵커로 초점을 보내면 행 자리로 화면이 튄다. 그래서
// onCloseAutoFocus 를 막아 왔고, 그 결과 Esc·바깥 클릭으로 닫으면 초점이 body 로 사라졌다(WCAG 2.4.3).
// 또 메뉴 항목이 연 입력기·대화상자의 초점을 빼앗아서도 안 되므로, "닫힌 뒤 아무도 초점을 가져가지 않았을 때만" 돌려준다.
// 진짜 트리거가 있는 메뉴(보드 컬럼 ⋯ 등)는 이 훅이 필요 없다 — onCloseAutoFocus 를 막지 않으면 Radix 가 트리거로 돌려준다.
import { useState } from 'react'

import { focusLost } from '@/hooks/useRestoreFocusOnExit'

/**
 * 메뉴가 열릴 때 초점이 있던 요소를 기억했다가, 닫힌 뒤 초점이 비어 있으면 그 요소로 돌려준다.
 * DropdownMenuContent 의 onCloseAutoFocus 에 반환값을 그대로 넘긴다.
 *
 * @param open 메뉴가 열려 있는지(열린 동안만 그리는 메뉴는 true)
 */
export function useMenuFocusReturn(open: boolean): { onCloseAutoFocus: (e: Event) => void } {
  // 직전 렌더의 open — 첫 렌더가 이미 open 이어도 "열림 전환"으로 보도록 false 로 시작한다.
  const [prevOpen, setPrevOpen] = useState(false)
  // 메뉴를 열 때 초점이 있던 요소
  const [returnTarget, setReturnTarget] = useState<HTMLElement | null>(null)

  // 렌더 중에 전환을 감지한다(「이전 prop 저장」 패턴). effect 는 Radix 가 초점을 메뉴 안으로 옮긴 뒤에
  // 돌 수 있어 그때는 이미 늦기 때문이다. 열린 동안의 재렌더는 prevOpen 이 true 라 덮어쓰지 않는다.
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      const active = document.activeElement
      setReturnTarget(active instanceof HTMLElement && active !== document.body ? active : null)
    }
  }

  const onCloseAutoFocus = (e: Event) => {
    // Radix 기본 복귀(0 크기 앵커로 초점)는 막는다.
    e.preventDefault()
    // 항목이 연 입력기·대화상자는 다음 프레임 안에 초점을 가져가므로 한 프레임 기다린 뒤 본다.
    requestAnimationFrame(() => {
      // 초점이 비었고 기억한 요소가 아직 문서에 있을 때만 — 화면이 행으로 튀지 않게 스크롤 없이.
      if (focusLost() && returnTarget?.isConnected) returnTarget.focus({ preventScroll: true })
    })
  }

  return { onCloseAutoFocus }
}
