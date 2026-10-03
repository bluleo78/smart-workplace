import { useEffect, useEffectEvent, useRef } from 'react'

/**
 * WP-214 메일 첫 열람 판정 — 상세 조회(markSeen=false)는 읽음 처리하지 않으므로, 메일을 열 때 한 번만 판정해 호출 측이 읽음 요청을 보낸다.
 *
 * - 판정은 열고 나서 새로 받은 상세의 seen 으로 한다. 상세 캐시는 이전 열람 때 값일 수 있어, 재조회 중에는 호출 측이 undefined 를 넘긴다.
 * - 같은 메일이 열려 있는 동안에는 다시 판정하지 않는다 — 다른 탭·기기에서 안읽음으로 바꿔 상세가 재조회돼도 다시 읽음 처리하지 않게.
 * - 닫거나 다른 메일로 옮기면 초기화해, 다시 열 때 다시 판정한다.
 *
 * @param openId 열린 메일 id(없으면 null)
 * @param seen 새로 받은 상세의 seen — 아직 없거나 재조회 중이면 undefined
 * @param onOpened 열 때 한 번 — 판정한 seen 과 함께 부른다(안 읽음이면 읽음 처리, 이미 읽음이면 보기 유지 등은 호출 측이 정한다)
 */
export function useMarkReadOnOpen(
  openId: number | null,
  seen: boolean | undefined,
  onOpened: (id: number, seen: boolean) => void,
) {
  const decidedRef = useRef<number | null>(null)
  const onOpenedEvent = useEffectEvent(onOpened)
  useEffect(() => {
    if (openId == null) {
      decidedRef.current = null
      return
    }
    if (decidedRef.current === openId || seen === undefined) return
    decidedRef.current = openId
    onOpenedEvent(openId, seen)
  }, [openId, seen])
}
