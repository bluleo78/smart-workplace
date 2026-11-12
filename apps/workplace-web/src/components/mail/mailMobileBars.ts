import type { Editor } from '@tiptap/core'

/**
 * 메일 작성 모바일 하단 고정 줄 자리(WP-1524) — 키보드 위 서식 줄과, 그 바로 위에 쌓는 줄(표 막대·서식판 등)의 위치를 한곳에 둔다.
 *
 * 왜 여기 모으나: 위 줄의 bottom 은 서식 줄의 실제 높이와 똑같아야 겹치지 않는다. 서식 줄 아래 여백에는 홈 바 safe-area
 * (`viewport-fit=cover` 라 노치 아이폰에서 약 34px)가 들어가므로, 숫자 하나(예: 2.875rem)로 적으면 그만큼 위 줄이 서식 줄을 덮는다.
 * 그래서 서식 줄 높이를 내용과 무관하게 고정하고(box-content h-11), 그 높이를 이루는 항목을 같은 값으로 위 줄 offset 에 다시 더한다.
 *
 * Tailwind 는 소스의 클래스 글자를 그대로 찾아 CSS 를 만들므로 문자열을 조립하지 않고 완성된 클래스를 적는다 —
 * 각 항목이 같은지는 mailMobileBars.test.ts 가 지킨다.
 */

/**
 * 모바일 서식 줄(MailComposer) — 키보드 높이(--kb-inset)만큼 띄운 화면 하단 고정.
 * 높이 = 위 테두리 1px + pt-0.5(0.125rem) + h-11(2.75rem, 44px 단추) + pb(max(0.125rem,env(safe-area-inset-bottom)) — 키보드가 닫히면 홈 바 safe-area 만큼). box-content 라 h-11 이 내용 높이로 고정된다.
 * 가로: 44px 단추 여덟 칸(굵게·기울임·글머리·번호·링크·표 넣기·서식 + AI로 쓰기) = 352px 에 px-1 양쪽 8px, 사이 간격 없음(gap-0)
 * = 360px — 360px 폭 안드로이드까지 넘치지 않는다(gap-1·px-2 면 396px 로 390px 아이폰에서도 넘친다).
 * z-10: 본문(ProseMirror, position:relative)이 DOM 상 뒤에 있어 길게 쓰면 글자가 툴바 위로 그려지므로 올린다.
 */
export const MAIL_MOBILE_FORMAT_BAR_CLASS =
  'fixed inset-x-0 bottom-[var(--kb-inset,0px)] z-10 box-content flex h-11 items-center gap-0 border-t bg-background px-1 pt-0.5 pb-[max(0.125rem,env(safe-area-inset-bottom))]'

/**
 * 서식 줄 바로 위에 붙는 고정 자리 — 표 막대 고정 줄과 서식판·표 패널이 쓴다.
 * bottom = 키보드 높이 + 서식 줄 높이(1px + 0.125rem + 2.75rem + safe-area 여백). 배경과 위 테두리까지 갖추고, 안쪽 배치는 쓰는 쪽이 덧붙인다.
 */
export const MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS =
  'fixed inset-x-0 bottom-[calc(var(--kb-inset,0px)+1px+0.125rem+2.75rem+max(0.125rem,env(safe-area-inset-bottom)))] z-10 border-t bg-background'

/**
 * 서식 줄 위 패널(서식판·표 격자 패널) 고정 자리 — 높이는 화면의 45% 까지, 넘치면 패널 안에서 세로 스크롤.
 * 높이 상한(보이는 높이 --vvh 의 45%)은 아래 MAIL_MOBILE_PANEL_RESERVE_CLASS 와 같은 값이어야 본문 끝이 패널 뒤에 갇히지 않는다(mailMobileBars.test.ts).
 */
export const MAIL_MOBILE_PANEL_CLASS = `${MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS} max-h-[calc(var(--vvh,100dvh)*0.45)] overflow-y-auto`

/**
 * 패널이 열린 동안 본문 아래에 까는 빈 자리 — 패널 최대 높이(--vvh 의 45%)만큼.
 * 작성 스크롤 영역의 아래 여백은 서식 줄 높이만 비워 두므로(MailComposeDock), 이것이 없으면 본문 끝(대개 커서 자리)이
 * 패널 뒤에 깔려 위로 올려 볼 수 없다. 서식 줄 몫은 그 여백이 이미 맡아 패널 높이만 더한다.
 */
export const MAIL_MOBILE_PANEL_RESERVE_CLASS = 'h-[calc(var(--vvh,100dvh)*0.45)] shrink-0'

/**
 * 표 막대 고정 줄(MailTableToolbar 모바일) — 높이를 고정(box-content h-11 + 위 테두리 1px)해 아래 빈 자리와 같은 값으로 묶는다.
 * 단추가 44px(size-11)이라 내용 높이가 늘 h-11 이다.
 */
export const MAIL_MOBILE_TABLE_ROW_CLASS = `${MAIL_MOBILE_ABOVE_FORMAT_BAR_CLASS} box-content h-11`

/**
 * 표 막대 고정 줄이 보이는 동안 본문 아래에 까는 빈 자리 — 줄 높이(2.75rem + 위 테두리 1px)만큼.
 * 작성 스크롤 영역의 아래 여백은 서식 줄 몫만 비우므로, 이것이 없으면 표가 마지막 블록일 때 맨 아래 줄이 막대 뒤에 갇힌다.
 */
export const MAIL_MOBILE_TABLE_ROW_RESERVE_CLASS = 'h-[calc(2.75rem+1px)] shrink-0'

/** 표 막대 고정 줄의 DOM id — 커서를 이 줄 위로 올릴 때(bringCaretAbovePanel) 윗변을 잰다. */
export const MAIL_MOBILE_TABLE_ROW_ID = 'mail-mobile-table-row'

/** 커서와 패널 윗변 사이에 남길 틈(px) — 커서가 패널 테두리에 딱 붙지 않게. */
const CARET_GAP_PX = 8

/**
 * 커서가 패널 뒤에 가렸으면 스크롤 영역을 그만큼 내려 커서를 패널 바로 위로 올린다.
 * caretBottom·panelTop 은 화면 좌표(getBoundingClientRect 기준). 가리지 않았으면 그대로 둔다. 옮긴 양(px)을 돌려준다.
 */
export function scrollCaretAbovePanel(scroller: { scrollTop: number }, caretBottom: number, panelTop: number): number {
  const overlap = caretBottom + CARET_GAP_PX - panelTop
  if (overlap <= 0) return 0
  scroller.scrollTop += overlap
  return overlap
}

/** el 을 감싼 가장 가까운 세로 스크롤 영역 — 없으면 문서 스크롤. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return document.scrollingElement as HTMLElement | null
}

/**
 * 커서(선택 끝)가 열린 모바일 패널 뒤에 가렸으면 본문 스크롤 영역을 내려 패널 바로 위로 올린다(MailComposer 가 부른다).
 * 좌표를 못 재는 환경(jsdom 등)이면 아무것도 하지 않는다.
 */
export function bringCaretAbovePanel(editor: Editor, panelId: string) {
  const panel = document.getElementById(panelId)
  if (!panel || editor.isDestroyed) return
  let caretBottom: number
  try {
    caretBottom = editor.view.coordsAtPos(editor.state.selection.head).bottom
  } catch {
    return
  }
  const scroller = scrollParentOf(editor.view.dom)
  if (scroller) scrollCaretAbovePanel(scroller, caretBottom, panel.getBoundingClientRect().top)
}
