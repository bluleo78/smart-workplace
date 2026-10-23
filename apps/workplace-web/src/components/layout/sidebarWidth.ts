// 앱 왼쪽 목록(2차 사이드바) 폭 — 범위·기본값과 앱별 localStorage 읽기/쓰기(WP-878).
// 컴포넌트 파일과 분리해 순수 로직만 둔다(react-refresh 규칙 + vitest 단위 테스트 대상).

/**
 * 기본 폭 — 사이드바들이 원래 쓰던 w-56(224px)과 같다. 저장값이 없으면 화면이 예전과 똑같다.
 * 각 사이드바 <aside> 의 w-56 은 래퍼(데스크톱 ResizableSidebar·모바일 sidebarListClass)가 덮으므로 실제 기본 폭은 여기서 정한다.
 */
export const SIDEBAR_DEFAULT_WIDTH = 224
/** 최소 폭 — 아이콘 + 짧은 이름이 잘리지 않는 정도. */
export const SIDEBAR_MIN_WIDTH = 180
/** 최대 폭 — 본문을 지나치게 밀어내지 않는 상한. */
export const SIDEBAR_MAX_WIDTH = 480

/** 앱마다 따로 기억한다(노트는 넓게, 설정은 좁게) — 키 예: sidebar-width:wiki */
const sidebarWidthKey = (widthKey: string) => `sidebar-width:${widthKey}`

/** 앱 영역(레일·AI 패널을 뺀 폭) 중 목록이 차지할 수 있는 비율 — 좁은 창·AI 패널을 연 화면에서 본문 자리를 남긴다. */
export const SIDEBAR_MAX_RATIO = 0.4

/** 범위 밖 값을 최소~최대로 맞춘다. max 는 그 화면의 실제 상한(기본 SIDEBAR_MAX_WIDTH). 소수는 정수 px 로 반올림. */
export function clampSidebarWidth(width: number, max = SIDEBAR_MAX_WIDTH): number {
  return Math.round(Math.min(Math.max(SIDEBAR_MIN_WIDTH, max), Math.max(SIDEBAR_MIN_WIDTH, width)))
}

/** 앱 영역 폭(containerWidth)에서 목록이 쓸 수 있는 상한 — SIDEBAR_MAX_WIDTH 와 비율 상한 중 작은 쪽. */
export function sidebarMaxFor(containerWidth: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.floor(containerWidth * SIDEBAR_MAX_RATIO))
}

/** 저장된 폭을 읽는다. 없거나 숫자가 아니거나 저장소 접근이 막혔으면(사생활 보호 모드 등) 기본 폭. */
export function readSidebarWidth(widthKey: string): number {
  try {
    const raw = localStorage.getItem(sidebarWidthKey(widthKey))
    if (raw === null) return SIDEBAR_DEFAULT_WIDTH
    const n = Number(raw)
    return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

/** 폭을 저장한다. 기본 폭이면 키를 지워 「손대지 않음」 상태로 돌린다. 저장 실패는 조용히 무시(폭은 이번 화면에서만 유지). */
export function writeSidebarWidth(widthKey: string, width: number): void {
  try {
    if (width === SIDEBAR_DEFAULT_WIDTH) localStorage.removeItem(sidebarWidthKey(widthKey))
    else localStorage.setItem(sidebarWidthKey(widthKey), String(width))
  } catch {
    // 저장소가 막힌 환경 — 무시
  }
}
