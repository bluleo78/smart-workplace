// 모바일 탭바 사용자 구성(가운데 AI·끝 앱 목록을 제외한 칸) — localStorage 기기별 저장.
// 늘 5개를 저장하고, 화면 폭에 따라 앞에서부터 보이는 칸 수만큼 쓴다(넓은 폰 5칸 = 탭바 7칸, 좁은 폰 3칸 = 탭바 5칸, WP-877).
// 손상 값은 조용히 기본값으로 복구하고, 예전 3칸 구성은 기본 앱으로 채워 5개로 늘린다(프라이빗 모드 등 storage 예외도 무시).
import { ALL_TAB_IDS, type MobileTabId } from './tabs'

const TAB_SLOTS_KEY = 'mobile-tabs'
export const DEFAULT_TAB_SLOTS: MobileTabId[] = ['home', 'chat', 'mail', 'calendar', 'drive']
// 저장하는 칸 수 = 넓은 폰에서 보이는 칸 수.
const SLOT_COUNT = DEFAULT_TAB_SLOTS.length
// 좁은 폰에서 보이는 칸 수 — WP-877 이전 구성의 칸 수와 같다.
const NARROW_SLOT_COUNT = 3

/** 기본 구성의 복사본 — 호출부가 결과 배열을 바꿔도 DEFAULT_TAB_SLOTS 가 오염되지 않게. */
const fallback = (): MobileTabId[] => [...DEFAULT_TAB_SLOTS]

/** 지금 화면에서 보이는 사용자 칸 수 — 넓으면 저장한 5칸 모두, 좁으면 앞의 3칸. */
export function visibleSlotCount(wide: boolean): number {
  return wide ? SLOT_COUNT : NARROW_SLOT_COUNT
}

/** 알려진 id·중복 없음 규칙을 만족하는 count 칸 구성인가. */
function isValidSlots(v: unknown, count: number): v is MobileTabId[] {
  return (
    Array.isArray(v) &&
    v.length === count &&
    v.every((x) => typeof x === 'string' && (ALL_TAB_IDS as string[]).includes(x)) &&
    new Set(v).size === v.length
  )
}

/**
 * 보이는 칸 구성(visible)을 저장 구성(all, 5칸)에 합친다 — 넓은 폰은 5칸을 다 넘기므로 visible 이 그대로 저장 구성이다.
 * 좁은 폰은 앞 3칸만 바꾸고 안 보이는 뒤 칸은 그대로 둔다. 다만 뒤 칸에 있던 앱을 앞으로 가져오면(고정·교체) 중복이 되므로
 * 그 자리에 앞에서 빠진 앱을 넣는다(자리 맞바꿈). 앞으로 온 뒤 칸 앱 수만큼 앞에서 빠진 앱이 있으므로 늘 채워진다.
 */
export function mergeVisibleSlots(all: readonly MobileTabId[], visible: readonly MobileTabId[]): MobileTabId[] {
  const freed = all.slice(0, visible.length).filter((id) => !visible.includes(id))
  const tail = all.slice(visible.length).map((id) => (visible.includes(id) ? freed.shift()! : id))
  return [...visible, ...tail]
}

/** 저장 문자열을 검증해 5칸 구성으로 변환. 예전 3칸 구성은 기본 앱으로 채우고, 규칙 위반·JSON 손상 시 기본값. */
export function parseTabSlots(raw: string | null): MobileTabId[] {
  if (!raw) return fallback()
  try {
    const v: unknown = JSON.parse(raw)
    if (isValidSlots(v, SLOT_COUNT)) return v
    // 예전 3칸 = 기본 구성의 앞 3칸을 고친 것으로 보고 합친다 — 뒤 칸은 기본 구성의 캘린더·드라이브(앞으로 옮겨 왔으면 빠진 기본 앱).
    return isValidSlots(v, NARROW_SLOT_COUNT) ? mergeVisibleSlots(DEFAULT_TAB_SLOTS, v) : fallback()
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

/**
 * localStorage 에서 탭 구성을 읽는다 — 접근 불가·손상 값이면 기본 구성.
 * 예전 3칸 구성은 읽을 때마다 채우고 다시 쓰지 않는다 — 아직 옛 버전 앱을 띄운 다른 창이 5칸 값을 못 읽어
 * 탭바가 기본값으로 돌아가지 않게. 사용자가 탭바를 고쳐 저장할 때 5칸으로 바뀐다.
 */
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

/**
 * 슬롯 하나를 제자리 교체한다 — 앱 목록의 "탭바에 고정(○○ 대신)"·"다른 앱으로 교체"가 공유.
 * 위치를 보존해야 사용자가 고른 칸에 새 앱이 들어간다. 교체 대상이 슬롯에 없거나 새 앱이 이미 슬롯에 있으면
 * (중복 금지 규칙) 원본 배열 참조를 그대로 돌려준다 — 호출부가 `next === slots` 로 "바뀌지 않음"을 판별해
 * 불필요한 저장·성공 토스트를 건너뛸 수 있게.
 */
export function replaceSlot(slots: MobileTabId[], from: MobileTabId, to: MobileTabId): MobileTabId[] {
  if (!slots.includes(from) || slots.includes(to)) return slots
  return slots.map((id) => (id === from ? to : id))
}
