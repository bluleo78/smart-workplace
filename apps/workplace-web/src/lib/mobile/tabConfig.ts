// 모바일 탭바 사용자 구성(가운데 AI·끝 더보기를 제외한 3칸) — localStorage 기기별 저장.
// 손상·구버전 값은 조용히 기본값으로 복구한다(프라이빗 모드 등 storage 예외도 무시).
import { ALL_TAB_IDS, type MobileTabId } from './tabs'

const TAB_SLOTS_KEY = 'mobile-tabs'
export const DEFAULT_TAB_SLOTS: MobileTabId[] = ['home', 'chat', 'mail']
const SLOT_COUNT = 3

/** 기본 구성의 복사본 — 호출부가 결과 배열을 바꿔도 DEFAULT_TAB_SLOTS 가 오염되지 않게. */
const fallback = (): MobileTabId[] => [...DEFAULT_TAB_SLOTS]

/** 3칸·알려진 id·중복 없음 규칙을 모두 만족하는 구성인가. */
function isValidSlots(v: unknown): v is MobileTabId[] {
  return (
    Array.isArray(v) &&
    v.length === SLOT_COUNT &&
    v.every((x) => typeof x === 'string' && (ALL_TAB_IDS as string[]).includes(x)) &&
    new Set(v).size === v.length
  )
}

/** 저장 문자열을 검증해 3칸 구성으로 변환. 규칙 위반·JSON 손상 시 기본값. */
export function parseTabSlots(raw: string | null): MobileTabId[] {
  if (!raw) return fallback()
  try {
    const v: unknown = JSON.parse(raw)
    return isValidSlots(v) ? v : fallback()
  } catch {
    return fallback()
  }
}

/** localStorage 를 안전하게 읽는다 — 접근 불가 환경(프라이빗 모드 등)이면 null(=기본 구성). */
function readSaved(): string | null {
  try {
    return localStorage.getItem(TAB_SLOTS_KEY)
  } catch {
    return null
  }
}

/** localStorage 에서 탭 구성을 읽는다 — 접근 불가·손상 값이면 기본 구성. */
export function loadTabSlots(): MobileTabId[] {
  return parseTabSlots(readSaved())
}

/** 탭 구성을 localStorage 에 저장한다 — 저장 불가 환경에선 조용히 무시. */
export function saveTabSlots(slots: MobileTabId[]): void {
  try {
    localStorage.setItem(TAB_SLOTS_KEY, JSON.stringify(slots))
  } catch {
    // 저장 불가 환경 — 이번 세션 메모리 상태로만 동작.
  }
}
