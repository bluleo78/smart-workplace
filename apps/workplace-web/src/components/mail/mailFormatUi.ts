/**
 * 메일 서식 UI 공용 조각(WP-1524) — 데스크톱 서식 둘째 줄(MailFormatRow)·모바일 서식판(MailFormatSheet)·작성창(MailComposer)이
 * 같이 쓰는 아이콘·초점 지키기·색 종류·줄 간격 토글·상자 클래스를 한곳에 둔다. 컴포넌트가 아니라 값·함수만 담는다.
 */
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react'

import type { MailAlign, MailLineHeight } from '@/lib/mailFormat'

/** 정렬 값 → 아이콘(서식 줄 트리거와 서식판 칩이 쓴다). */
export const ALIGN_ICONS: Record<MailAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
}

/** 누를 때·메뉴를 닫을 때 편집기 초점을 뺏기지 않게 한다 — 마우스 이벤트와 Radix 닫힘 이벤트가 함께 쓴다. */
export function keepEditorFocus(e: { preventDefault(): void }) {
  e.preventDefault()
}

/** 색 종류별 고정 값 — 단추·칩 이름과 팔레트에서 쓰는 16진 필드(글자=text, 배경=mark). */
export const MAIL_COLOR_KINDS = {
  color: { label: '글자색', field: 'text' },
  background: { label: '배경색', field: 'mark' },
} as const

/** 줄 간격을 고른다 — 지금 값을 다시 고르면 null(선언 지움: 「선택 안 함」으로 돌아가는 길). */
export function toggleLineHeight(picked: MailLineHeight, current: MailLineHeight | null): MailLineHeight | null {
  return picked === current ? null : picked
}

/** 서식 줄 상자 — 1행(작성창 도구 막대)과 둘째 줄이 한 도구 막대처럼 보이게 같은 모양을 쓴다. */
export const MAIL_BOXED_ROW_CLASS = 'flex items-center gap-0.5 rounded-md border bg-muted/40 p-1'
