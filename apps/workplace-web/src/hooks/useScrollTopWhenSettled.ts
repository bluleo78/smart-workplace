// 새 조건의 결과가 실제로 보이게 되면 스크롤을 맨 위로(WP-1049).
// 조건을 바꾸면 이전 결과를 흐리게 둔 채 새 결과를 받는다(RefreshingResults). 스크롤 컨테이너가 그대로 남으므로
// 새 결과가 들어오는 순간 맨 위로 올려야 예전(스켈레톤으로 바꿨다 다시 그리던 때)처럼 새 목록이 첫 줄부터 보인다.
// 흐린 동안 올리면 이전 목록이 한 번 튀므로, 기준 키는 자리채움이 끝난 때에만 바뀐다(렌더 중 조건부 setState — 효과 왕복 없음).
import { useLayoutEffect, useState } from 'react'

export function useScrollTopWhenSettled(el: HTMLElement | null, key: string, refreshing: boolean) {
  const [settled, setSettled] = useState(key)
  if (!refreshing && settled !== key) setSettled(key)
  useLayoutEffect(() => {
    el?.scrollTo({ top: 0 })
  }, [settled, el])
}
