import type { KeyboardEvent } from 'react'

// 클릭 가능한 <tr>(또는 임의 요소)에 키보드 접근성(WAI-ARIA role=button 계약)을 부여하는 공용 함수.
// React 훅이 아니라 순수 함수 — .map() 콜백 안에서 호출해도 Rules of Hooks 위반이 아니다.
// tabIndex=0 + role="button" + Enter/Space onKeyDown 을 일괄 스프레드로 적용한다 (#810).
export function clickableRowProps(onActivate: () => void, ariaLabel?: string) {
  return {
    tabIndex: 0,
    role: 'button' as const,
    ...(ariaLabel != null ? { 'aria-label': ariaLabel } : {}),
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  }
}
