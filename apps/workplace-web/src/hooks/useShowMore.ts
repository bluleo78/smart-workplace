// 「외 N명 더 보기 / 접기」 접기 상태 — 일정 상세의 참석자 목록과 일정 폼의 참석자 칩이 같이 써 문구·동작이 갈리지 않게 한다(WP-1189).
import { useState } from 'react'

/**
 * 처음엔 앞 preview 개만 보이고 넘친 수를 「외 N명 더 보기」로 접는다.
 * limit 으로 목록을 자르고(slice(0, limit)), overflow 가 0 보다 클 때만 단추(label·toggle)를 둔다. collapse 는 펼친 것을 다시 접는다.
 */
export function useShowMore(count: number, preview: number) {
  const [expanded, setExpanded] = useState(false)
  const overflow = Math.max(0, count - preview)
  return {
    expanded,
    overflow,
    limit: expanded ? count : preview,
    label: expanded ? '접기' : `외 ${overflow}명 더 보기`,
    toggle: () => setExpanded((v) => !v),
    collapse: () => setExpanded(false),
  }
}
