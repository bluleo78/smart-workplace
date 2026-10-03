import { useEffect, useEffectEvent, useRef } from 'react'

/**
 * WP-214 메일 첫 열람 읽음 처리 — 상세 조회(markSeen=false)는 읽음 처리하지 않으므로, 메일을 열 때 한 번만 명시적으로 읽음 요청을 보낸다.
 *
 * - 판정은 목록 행의 seen 을 먼저 쓴다(상세 캐시는 이전 열람 때 값일 수 있다). 목록에 없는 메일(?messageId 딥링크 등)은 상세 응답의 seen 으로 판정한다.
 * - 같은 메일이 열려 있는 동안에는 다시 판정하지 않는다 — 다른 탭·기기에서 안읽음으로 바꿔 목록·상세가 재조회돼도 다시 읽음 처리하지 않게.
 * - 닫거나 다른 메일로 옮기면 초기화해, 다시 열 때 다시 판정한다.
 *
 * 원시값만 받는다 — 목록 배열을 effect 에 넘기면 React Compiler 가 화면의 메모이제이션을 포기한다.
 *
 * @param openId 열린 메일 id(없으면 null)
 * @param rowSeen 목록 행의 seen — 목록에 없거나 아직 로딩 중이면 undefined
 * @param detailSeen 상세 응답의 seen — 아직 없으면 undefined
 * @param markRead 안 읽은 메일을 열었을 때 부를 읽음 처리
 */
export function useMarkReadOnOpen(
  openId: number | null,
  rowSeen: boolean | undefined,
  detailSeen: boolean | undefined,
  markRead: (id: number) => void,
) {
  const decidedRef = useRef<number | null>(null)
  const onUnreadOpened = useEffectEvent(markRead)
  useEffect(() => {
    if (openId == null) {
      decidedRef.current = null
      return
    }
    if (decidedRef.current === openId) return
    const seen = rowSeen ?? detailSeen
    if (seen === undefined) return // 목록·상세 모두 아직 — 다음 응답에서 다시 판정
    decidedRef.current = openId
    if (!seen) onUnreadOpened(openId)
  }, [openId, rowSeen, detailSeen])
}
