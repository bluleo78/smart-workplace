// 모바일 탭바 사용자 구성(가운데 AI·끝 더보기를 제외한 3칸) — localStorage 기기별 저장.
// 손상·구버전 값은 조용히 기본값으로 복구한다(프라이빗 모드 등 storage 예외도 무시).
import { ALL_TAB_IDS, type MobileTabId } from './tabs'

export const TAB_SLOTS_KEY = 'mobile-tabs'
export const DEFAULT_TAB_SLOTS: MobileTabId[] = ['home', 'chat', 'mail']
const SLOT_COUNT = 3

/** 저장 문자열을 검증해 3칸 구성으로 변환. 규칙 위반 시 기본값. */
export function parseTabSlots(raw: string | null): MobileTabId[] {
  if (!raw) return [...DEFAULT_TAB_SLOTS]
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v) || v.length !== SLOT_COUNT) return [...DEFAULT_TAB_SLOTS]
    if (!v.every((x) => typeof x === 'string' && (ALL_TAB_IDS as string[]).includes(x))) return [...DEFAULT_TAB_SLOTS]
    if (new Set(v).size !== v.length) return [...DEFAULT_TAB_SLOTS]
    return v as MobileTabId[]
  } catch {
    return [...DEFAULT_TAB_SLOTS]
  }
}

export function loadTabSlots(): MobileTabId[] {
  try {
    return parseTabSlots(localStorage.getItem(TAB_SLOTS_KEY))
  } catch {
    return [...DEFAULT_TAB_SLOTS]
  }
}

export function saveTabSlots(slots: MobileTabId[]): void {
  try {
    localStorage.setItem(TAB_SLOTS_KEY, JSON.stringify(slots))
  } catch {
    // 저장 불가 환경 — 이번 세션 메모리 상태로만 동작.
  }
}
