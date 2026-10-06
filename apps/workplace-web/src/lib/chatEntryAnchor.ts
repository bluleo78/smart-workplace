/** 목록 상단 캐치업 슬롯(카드·요약 버튼) 래퍼 DOM id — 진입 스크롤 앵커로 쓴다(WP-256). */
export const CATCHUP_TOP_ANCHOR_ID = 'catchup-top-anchor'
/** "여기까지 읽음" 구분선 DOM id(UnreadDivider). */
export const UNREAD_DIVIDER_ANCHOR_ID = 'unread-divider'

/** 진입 시 스크롤 앵커 — id 요소로 이동하고 align 으로 세로 정렬을 정한다. */
export interface EntryAnchor {
  id: string
  /** center = 요소를 화면 가운데, start = 요소 윗변을 화면 위쪽에 맞춤 */
  align: 'center' | 'start'
}

/**
 * 채널/DM 진입 시 최초 스크롤 위치를 정한다.
 *
 * - 구분선이 있으면 구분선을 가운데로(기존 동작 유지). 캐치업 카드는 구분선 바로 아래에 렌더된다.
 * - 구분선이 없는데 목록 상단에 캐치업 카드/요약 버튼이 있으면 그 윗변으로(start).
 *   빈 채널 생성자·새 DM(기준점 null)이나, 첫 페이지 전체가 미읽음인 경우다. 바닥에서 시작하면 카드가
 *   화면 밖이고, 마지막 메시지가 보이는 순간 자동 읽음 처리돼 다음 방문엔 카드조차 사라진다.
 *   카드가 크므로 center 가 아니라 start 로 맞춰 윗부분이 잘리지 않게 한다.
 * - 둘 다 없으면 undefined → 바닥 고정.
 */
export function chatEntryAnchor(
  unreadDividerBeforeId: number | null,
  hasCatchupSlot: boolean,
): EntryAnchor | undefined {
  if (unreadDividerBeforeId != null) return { id: UNREAD_DIVIDER_ANCHOR_ID, align: 'center' }
  if (hasCatchupSlot) return { id: CATCHUP_TOP_ANCHOR_ID, align: 'start' }
  return undefined
}
