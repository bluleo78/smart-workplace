import { useEffect, useState } from 'react'

// 값이 delay(ms) 동안 바뀌지 않을 때만 반영한다 — 타이핑마다 검색 요청이 나가지 않게 한다.
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
