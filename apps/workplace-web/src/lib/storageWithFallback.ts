// localStorage 읽기·쓰기 + 막혔을 때의 탭 한정 메모리 대체 — 화면 설정 기억(이슈 목록 열 WP-270, 필터·보기 WP-1035)이 같이 쓴다.
// 사생활 보호 모드·보안 정책으로 저장소에 쓰지 못하면 이 탭에서만 기억해, 적어도 탭 안에서는 바꾼 설정이 유지되게 한다.
import { safeLocalStorage } from './safeLocalStorage'

// 저장소에 쓰지 못했을 때만 쓰는 이 탭 한정 값 — 쓰기에 성공하면 비운다(null 은 「지움」을 기억한 것).
// 평소엔 비어 있어 읽기는 언제나 localStorage 원문이다.
const memoryFallback = new Map<string, string | null>()

/** 저장 원문 — 없거나 읽을 수 없으면 null. 쓰기가 막혀 메모리에 둔 값이 있으면 그것을 먼저 본다. */
export function readStored(key: string): string | null {
  if (memoryFallback.has(key)) return memoryFallback.get(key) ?? null
  try {
    return safeLocalStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 원문을 쓴다(null 이면 지운다). 저장소가 막혔으면 이 탭에서만 기억한다. */
export function writeStored(key: string, value: string | null): void {
  try {
    const storage = safeLocalStorage()
    if (!storage) throw new Error('no storage')
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, value)
    memoryFallback.delete(key)
  } catch {
    memoryFallback.set(key, value)
  }
}
