// 앱이 받는 날짜 범위(WP-725) — 서버 SupportedDates(1900-01-01 ~ 9999-12-31)와 같은 값. 날짜 칸이 저장 요청 전에 거른다(WP-903).
// native <input type="date"> 는 연도를 치는 도중에도 「0002-10-23」 같은 완성된 값을 onChange 로 내보내므로,
// 이 범위 안의 값만 저장하면 입력 도중의 값이 서버로 가 거절되지 않는다.

/** 받는 날짜의 최솟값·최댓값(YYYY-MM-DD) — input 의 min·max 로도 쓴다. */
export const SUPPORTED_DATE_MIN = '1900-01-01'
export const SUPPORTED_DATE_MAX = '9999-12-31'

/** 범위를 벗어났을 때의 안내 — 서버 거절 문구와 같다. */
export const SUPPORTED_DATE_RANGE_MESSAGE = '날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다'

/** YYYY-MM-DD 형식이고 범위 안이면 참 — 형식이 같아 문자열 비교로 범위를 본다. 달력에 없는 날(2월 30일)은 input 이 내보내지 않는다. */
export function isSupportedDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && key >= SUPPORTED_DATE_MIN && key <= SUPPORTED_DATE_MAX
}
