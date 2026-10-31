// 줄 링크 메뉴(RowLinkMenu, WP-1236)를 여는 자리 — 우클릭 지점·⋯ 단추 모서리. 컴포넌트 파일과 나눠 둔다(fast refresh 규칙).
import type { MouseEvent } from 'react'

/** 메뉴를 연 자리 — 우클릭 지점(start) 또는 ⋯ 단추 아래 모서리(end). */
export interface RowLinkMenuAnchor {
  x: number
  y: number
  align: 'start' | 'end'
}

/**
 * 우클릭으로 링크 메뉴를 열지 정하고 자리를 돌려준다 — 열지 않으면 null(브라우저 기본 메뉴를 그대로 둔다).
 * 링크·이미지 위, 글을 고른 채, 입력 칸 안의 우클릭은 브라우저 메뉴(링크 주소 복사·이미지 저장·선택 복사·붙여 넣기)가 더 쓸모 있어 가로채지 않는다.
 * 키보드(Shift+F10·메뉴 키)로 연 것은 좌표가 요소 밖이라 요소 왼쪽 아래에 연다(이슈 행 우클릭과 같은 규칙).
 */
export function rowLinkMenuAnchorFromContextMenu(e: MouseEvent<HTMLElement>): RowLinkMenuAnchor | null {
  const t = e.target as HTMLElement | null
  if (t?.closest('a, img, video, input, textarea, [contenteditable="true"]')) return null
  const selection = typeof window !== 'undefined' ? window.getSelection() : null
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return null
  const r = e.currentTarget.getBoundingClientRect()
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  return inside ? { x: e.clientX, y: e.clientY, align: 'start' } : { x: r.left + 16, y: r.bottom, align: 'start' }
}

/** ⋯ 단추 아래 오른쪽 모서리 자리. */
export function rowLinkMenuAnchorFromButton(el: HTMLElement): RowLinkMenuAnchor {
  const r = el.getBoundingClientRect()
  return { x: r.right, y: r.bottom, align: 'end' }
}
