// 기준값(dep)이 바뀔 때마다 기본값으로 되돌아가는 상태 훅 — 뷰어의 바 숨김(가로/세로 회전)·모바일 요약 시트(배치 전환)가 쓴다(WP-278).
import { useCallback, useState } from 'react'

/**
 * dep 이 바뀌면 상태를 initial 로 되돌린다. 렌더 중 상태 갱신으로 수렴한다(이펙트 setState 가 아님) —
 * 바뀐 렌더는 곧바로 다시 그려지고 그 결과는 버려지므로, 커밋되는 값은 항상 새 dep 기준이다.
 * 왜 "저장된 dep 과 다를 때만 기본값" 식의 파생이 아닌가: 가로→(사용자가 바꿈)→세로→가로 처럼 dep 이 원래 값으로
 * 돌아오면 파생은 낡은 값을 되살린다. 여기서는 dep 이 바뀌는 순간 저장값 자체를 지운다.
 * initial 은 지금 dep 기준의 기본값을 매 렌더 넘긴다(예: 바 숨김 기본 = 가로 여부).
 * 반환 setter 는 지금 dep 에 묶어 저장한다.
 */
export function useResetOnChange<T>(dep: unknown, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState({ dep, value: initial })
  const stale = state.dep !== dep
  if (stale) setState({ dep, value: initial })
  const set = useCallback((value: T) => setState({ dep, value }), [dep])
  return [stale ? initial : state.value, set]
}
