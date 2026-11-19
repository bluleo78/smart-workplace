// 도움말 패널 `?` 단축키 판정(WP-1505).
// `?` 는 글자이기도 하므로 글을 쓰는 곳·IME 조합·조합 키·포커스를 가두는 모달·키 입력을 받는 팝업에서는 단축키로 보지 않는다(계획 Review Focus 2).
// 막는 오버레이는 공용 OPEN_OVERLAY_SELECTOR(Esc 판정 — lib/escapeOverlay)보다 좁다: 그 선택자는 툴팁(popper)·AI 옆 비모달 대화상자까지 잡아
// 레일 아이콘 툴팁이 떠 있거나 비모달 엔티티 대화상자가 열려 있으면 `?` 가 먹지 않았다. Esc 쪽 동작은 그대로 두고 도움말 전용 판정을 둔다.
import { isEditableTarget } from '@/lib/escapeOverlay'
import { isImeComposing } from '@/lib/imeKey'

/** 닫히는 중인 층을 빼는 꼬리 — 아래 hasBlockingOverlay 설명 참고. */
const NOT_CLOSING = ':not([data-state="closed"])'

/** 열려 있기만 해도 `?` 를 막는 층: aria-modal 대화상자·경고 대화상자(포커스를 가둔다), 메뉴·목록(화살표·글자 입력을 받는다). */
const BLOCKING_OVERLAY_SELECTOR = ['[role="dialog"][aria-modal="true"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]']
  .map((selector) => selector + NOT_CLOSING)
  .join(', ')

/** 닫히지 않은 대화상자 층 — aria-modal 이 없는 모달 Popover 도 여기 든다. */
const OPEN_DIALOG_LAYER = `[role="dialog"]${NOT_CLOSING}`

/**
 * 포커스를 가두는 오버레이가 열려 있는가.
 * - 닫히는 중(data-state=closed)인 층은 세지 않는다. Radix Presence 는 퇴장 애니메이션 동안 Content 를 남기고, hideOthers 가 바깥 형제에 단
 *   data-aria-hidden 도 그 끝까지 남아, 모달을 막 닫은 직후의 `?` 가 무시됐다.
 * - data-aria-hidden 은 그 자신이 숨겨지지 않은 열린 대화상자 층(모달 Popover 등)이 있을 때만 막는다 — hideOthers 는 지금 모달 층의 바깥을 숨기므로
 *   남은 표식에 함께 숨겨진 층(AI 옆 비모달 대화상자·인물 카드·손수 만든 role=dialog 패널)은 포커스를 가두는 층이 아니다.
 *   표식이 없으면 열린 비모달 대화상자만으로는 막지 않으므로 아래 조기 반환은 동작상 필요하다.
 */
function hasBlockingOverlay(): boolean {
  if (document.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null) return true
  if (document.querySelector('[data-aria-hidden]') === null) return false
  return Array.from(document.querySelectorAll(OPEN_DIALOG_LAYER)).some((el) => el.closest('[data-aria-hidden]') === null)
}

/**
 * 포커스가 팝오버(Radix popper 안 — 비모달 Popover 등) 안에 있는가. 키 입력을 받는 작은 팝업이라 뒤에서 패널이 여닫히면 팝업이 닫히며 흔들린다.
 * 툴팁도 popper 안이지만 포커스를 받지 않으므로 여기 걸리지 않는다. 비모달 엔티티 대화상자 안의 `?` 는 그 대화상자가 쓰는 키가 아니라 받는다.
 */
function isInPopper(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-radix-popper-content-wrapper]') !== null
}

/**
 * 이 keydown 이 도움말 패널을 여닫는 `?` 인가.
 * - Shift+/ 로 나오는 `?` 는 받는다(대부분 자판에서 `?` 는 Shift 와 함께 나온다). ⌘/Ctrl/Alt 가 끼면 다른 단축키로 본다.
 * - 누른 채 반복되는 keydown(e.repeat)은 무시한다 — `?` 를 누르고 있는 동안 패널이 계속 여닫히지 않게.
 * - 입력 칸·편집기 안, IME 조합 중(Safari 의 keyCode 229 포함), 다른 핸들러가 이미 처리한 키는 글자 몫이다.
 * - 포커스를 가두는 모달·열린 메뉴·목록이 있거나 포커스가 팝오버 안이면 그 오버레이 몫이다 — 뒤에서 패널이 여닫혀 포커스·레이아웃이 흔들리지 않게.
 *   툴팁·AI 옆 비모달 대화상자는 막지 않는다.
 */
export function isHelpShortcut(e: KeyboardEvent): boolean {
  if (e.key !== '?' || e.repeat) return false
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  if (e.defaultPrevented || isImeComposing(e)) return false
  if (isEditableTarget(e.target)) return false
  if (isInPopper(e.target)) return false
  return !hasBlockingOverlay()
}
