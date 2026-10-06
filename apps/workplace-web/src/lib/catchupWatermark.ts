import type { ChannelResponse } from '@/types/messaging'

/**
 * 캐치업(카드·"놓친 대화 요약" 버튼·요약 API since)에 쓸 유효 읽음 기준점을 구한다(WP-256).
 *
 * - 상세 미로드(loading) → null: 아직 판단 불가이므로 캐치업을 띄우지 않는다.
 * - 비멤버 → null: 서버 캐치업 API 가 403 이고, 서버도 비멤버 기준점을 null 로 준다.
 * - 멤버인데 기준점 null → 0: 빈 채널을 만든 생성자·새 DM 의 양쪽처럼 "가입 시 메시지가 0건"이라
 *   서버가 MAX(id)=NULL 로 기록한 경우다. 서버 배지·요약은 coalesce(…,0) 으로 "전부 미읽음"으로
 *   세므로 웹도 같은 해석을 써야 배지만 뜨고 캐치업이 안 뜨는 불일치가 사라진다.
 *
 * "여기까지 읽음" 구분선은 이 값을 쓰지 않는다 — 원본 기준점(null 포함)을 그대로 넘겨
 * "위에 읽은 메시지가 없으면 구분선 없음" 동작(unreadBoundary)을 유지한다.
 */
export function catchupWatermark(
  detail: Pick<ChannelResponse, 'member' | 'lastReadMessageId'> | undefined,
): number | null {
  if (!detail || !detail.member) return null
  return detail.lastReadMessageId ?? 0
}
