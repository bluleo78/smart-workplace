// 모바일 배지 숫자 표기 — 탭바·헤더 벨이 같은 규칙(99 초과 시 '99+')을 쓰도록 단일화.
export const BADGE_MAX = 99

/** 배지에 표시할 문자열. 99 초과는 '99+' 로 축약한다. */
export function formatBadgeCount(n: number): string {
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n)
}
