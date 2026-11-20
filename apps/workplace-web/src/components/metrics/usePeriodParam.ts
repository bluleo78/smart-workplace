// 기간 값을 주소 파라미터에 두는 훅(WP-1822) — 공유·새로고침해도 유지된다.
// 기본값은 주소에 적지 않고, 모르는 값은 기본값으로 본다. 다른 파라미터는 건드리지 않고 이력도 쌓지 않는다(replace).
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** [현재 값, 바꾸기]. values 에 없는 값(주소 손질 등)은 defaultValue. */
export function usePeriodParam<T extends string>(key: string, values: readonly T[], defaultValue: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = values.find((v) => v === raw) ?? defaultValue
  const set = useCallback(
    (v: T) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v === defaultValue) next.delete(key)
          else next.set(key, v)
          return next
        },
        { replace: true },
      ),
    [key, defaultValue, setParams],
  )
  return [value, set]
}
