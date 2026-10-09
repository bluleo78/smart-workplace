// IME(한글 등) 조합 중 키 입력 판정 — 조합 중 Enter·Backspace·Esc 는 글자 확정·편집용이라 앱 동작(전송·이동·닫기)으로 보지 않는다.
// Safari 는 조합 확정 직후 keydown 을 isComposing=false, keyCode=229 로 보내므로 229 도 조합 신호로 본다.

/** 이 keydown 이 IME 조합에 속한 키 입력인지. 네이티브 KeyboardEvent 를 넘긴다(React 이벤트면 e.nativeEvent). 키 종류는 보지 않는다. */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * 조합 확정 직후 따라오는 Enter 를 무시하는 시간(ms) — macOS Chrome 한글 IME 는 조합 중 Enter 를 isComposing keydown 으로 보낸 뒤
 * compositionend 와 함께 조합이 아닌 Enter keydown 을 한 번 더 보낸다(같은 키 입력이라 몇 ms 안). 시간으로 거르는 이유:
 * Windows Chrome·Firefox 는 뒤따르는 Enter 를 보내지 않으므로 기한 없이 "다음 Enter 무시"를 걸면 사용자의 진짜 Enter 를 삼킨다.
 */
export const IME_TRAILING_ENTER_MS = 100;

/**
 * 두 이벤트가 같은 키 입력에 딸린 것으로 볼 만큼 가까운지(IME_TRAILING_ENTER_MS 안) — 둘 다 event.timeStamp.
 * 꼬리 Enter 판정에 쓴다: 조합 Enter → compositionend, compositionend → 꼬리 Enter 가 각각 이 창 안에 온다.
 */
export function isTrailingImeEnter(enterTimeStamp: number, lastCompositionEnd: number): boolean {
  return enterTimeStamp - lastCompositionEnd < IME_TRAILING_ENTER_MS;
}
