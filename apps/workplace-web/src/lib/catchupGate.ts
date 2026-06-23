/** 캐치업 카드 자동 표시 임계 — 미읽음 5건 이상일 때만(알림 폭격 방지). */
export const CATCHUP_AUTO_THRESHOLD = 5

export function shouldAutoShowCatchup(unreadCount: number): boolean {
  return unreadCount >= CATCHUP_AUTO_THRESHOLD
}
