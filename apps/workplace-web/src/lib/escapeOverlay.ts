// 바깥 패널·팝오버의 Esc 닫기가 안쪽 오버레이(선택 목록·메뉴·확인 창)의 Esc 까지 먹지 않게 하는 판정(WP-698).

// 열려 있는 오버레이(다이얼로그·드로워·메뉴·팝오버·툴팁) — ESC 는 이것을 닫는 데 먼저 쓰인다.
// Radix 는 닫을 때 preventDefault 를 하지 않으므로 defaultPrevented 만으로는 구분되지 않아 DOM 으로 판정한다.
// (Radix 의 닫기 상태 갱신은 이벤트 전파가 끝난 뒤 반영되므로 바깥 리스너가 도는 시점엔 오버레이가 아직 DOM 에 있다.)
export const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/**
 * 이 Esc 가 바깥 패널·팝오버를 닫는 데 쓰이면 안 되는지 — 한글 조합 중이거나, 다른 핸들러가 이미 처리했거나,
 * 자기 자신(self — 그 패널·팝오버) 말고 열린 오버레이가 있으면 그 Esc 는 그 오버레이 몫이다.
 */
export function isEscapeForInnerOverlay(e: KeyboardEvent, self?: Element | null): boolean {
  if (e.defaultPrevented || e.isComposing) return true;
  return Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).some((el) => el !== self);
}
