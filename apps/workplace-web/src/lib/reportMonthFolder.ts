// 개인 보고 달 폴더 제목 판정 — 서버 `PersonalReportMonthFolder` 와 같은 규칙을 쓴다(웹이 숨기는 것 = 서버가 거절하는 것).

// 「2026년 11월」 꼴 — 연도 4자리, 월 1~2자리. 앞뒤 공백·덧붙은 글자는 달 폴더가 아니다.
const MONTH_FOLDER_TITLE = /^(\d{4})년 (\d{1,2})월$/

/**
 * 제목이 개인 보고 달 폴더(`2026년 11월`)인지 — 월이 1~12 일 때만 참이다.
 * 저장 위치 고르기 창이 달 폴더와 그 아래를 목록에서 빼는 데 쓴다(서버도 그 아래는 400 으로 거절).
 */
export function isMonthFolderTitle(title: string): boolean {
  const m = MONTH_FOLDER_TITLE.exec(title)
  if (!m) return false
  const month = Number(m[2])
  return month >= 1 && month <= 12
}
