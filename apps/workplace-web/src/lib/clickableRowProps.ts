import type { KeyboardEvent } from 'react'

// 클릭 가능한 <tr>(또는 임의 요소)에 키보드 접근성(WAI-ARIA role=button 계약)을 부여하는 공용 함수.
// React 훅이 아니라 순수 함수 — .map() 콜백 안에서 호출해도 Rules of Hooks 위반이 아니다.
// tabIndex=0 + role="button" + Enter/Space onKeyDown 을 일괄 스프레드로 적용한다 (#810).
// 안에 버튼·링크가 없는 행에만 쓴다 — 있으면 button 중첩이 되므로 RoleListPage 처럼 이름 링크를 진입점으로 둔다(WP-1555).
export function clickableRowProps(onActivate: () => void, ariaLabel?: string) {
  return {
    tabIndex: 0,
    role: 'button' as const,
    ...(ariaLabel != null ? { 'aria-label': ariaLabel } : {}),
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      // 행 안 버튼·링크 등 자식에서 버블링된 키는 행이 가로채지 않는다.
      // 가로채면 preventDefault 로 자식 버튼의 Enter click 이 취소되고 행이 대신 활성화되던 문제(WP-1555).
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  }
}
