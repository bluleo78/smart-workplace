/**
 * WP-2065 — 일괄 작업 바가 나타났을 때 스크린리더에 읽어 줄 선택 개수 문구를 만든다.
 * 선택이 없으면(0 이하) 바가 사라지므로 낭독할 문구도 없어 빈 문자열을 낸다.
 * 한국어 문구 「선택 N개, 일괄 작업 사용 가능」 은 바 진입을 알리는 용도로 고정한다.
 */
export function bulkSelectionAnnouncement(count: number): string {
  if (count <= 0) return ''
  return `선택 ${count}개, 일괄 작업 사용 가능`
}
