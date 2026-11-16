// 날짜 입력(<input type="date">) 공용 판정 — 덜 넣은 날짜를 「비움」과 가른다(WP-1625·WP-1644).
// 브라우저는 날짜를 덜 넣으면(예: '2026-12-' 까지만) 값을 '' 로 올려 완전히 비운 칸과 구분되지 않고, 빈 칸에서 일부만 치면
// input/change 이벤트도 오지 않는다. 그래서 폼 상태 값으로는 가를 수 없고 입력 요소의 validity.badInput 을 직접 읽어야 한다.
// 막지 않으면 날짜를 정한 줄 알고 저장했는데 날짜 없이 저장된다.

/** 날짜 칸을 덜 넣은 채 저장하려 할 때 칸 아래에 보이는 공용 안내. */
export const INCOMPLETE_DATE_MESSAGE = '날짜를 끝까지 입력하거나 칸을 비워 주세요.';

/**
 * 날짜 입력 요소가 「덜 넣은 날짜」 상태인가 — 입력 요소가 아니면(없음·아직 안 그려짐·폼 라이브러리의 다른 ref) false.
 * 완전히 비운 칸은 badInput 이 false 라 false 이므로 「날짜 없음」으로 그대로 저장된다.
 */
export function isIncompleteDateInput(el: unknown): boolean {
  return el instanceof HTMLInputElement && el.validity.badInput;
}
