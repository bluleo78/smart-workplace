// Root 가 받은 modal 값을 Content 에 전하는 context 와 aria-modal 값 계산(WP-1771).
// 왜: Radix 는 content 에 aria-modal 을 달지 않고(바깥 aria-hidden 만) Root 의 modal 도 Content 에 알려주지 않는다.
// 그래서 Dialog·Sheet·원시 시트(RawSheetRoot)가 modal 을 이 context 로 내리고, 각 Content 는 useAriaModal() 로 읽어 단다.
// 모달이면 true, non-modal(AI side 패널 모드)은 바깥을 숨기면 안 되므로 속성 자체가 없다(false 가 아님).
// Content 는 이 값을 {...props} 앞에 두어 호출부가 직접 넘긴 aria-modal 이 이긴다.
import { createContext, useContext } from "react"

export const DialogModalContext = createContext<boolean>(true)

/** 현재 Root 의 modal 값에 따른 aria-modal 속성 값 — 모달이면 true, 아니면 undefined(속성 없음). */
export function useAriaModal(): true | undefined {
  return useContext(DialogModalContext) ? true : undefined
}
