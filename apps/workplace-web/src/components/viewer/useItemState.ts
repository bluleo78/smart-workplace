// 뷰어 항목(itemKey)에 묶인 상태 훅 — 확대 배율·PDF 현재 쪽·원본 blob 이 쓴다(WP-276·278).
import { useCallback, useState } from 'react'

/**
 * 값을 항목 key 와 함께 들어, 지금 항목의 것이 아니면 initial 로 본다 — 다른 항목으로 넘기면 따로 초기화하지 않아도 무시된다.
 * (지운 게 아니라 무시하는 것이므로 다른 항목에서 아무것도 저장하지 않고 돌아오면 이전 값이 다시 보인다 — 기존 동작 그대로.)
 * setter 는 지금 항목 key 에 묶이고, key 가 같은 동안 같은 참조를 유지한다(이펙트 의존성·memo 자식 props 로 넘겨도 흔들리지 않게).
 */
export function useItemState<T>(itemKey: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<{ key: string; value: T } | null>(null)
  const set = useCallback((value: T) => setState({ key: itemKey, value }), [itemKey])
  return [state != null && state.key === itemKey ? state.value : initial, set]
}
