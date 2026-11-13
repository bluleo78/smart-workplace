// 월간 뷰 칸 채움 계산 — 날짜 칸 하나에 일정·마감 이슈 칩이 몇 개 들어가는지 정하는 순수 함수.
// 칩이 쌓여 아래 주가 화면 밖으로 밀리지 않도록, 칸 높이(행 높이)를 기준으로 앞에서부터 채운다.

// 셀 레이아웃 상수(px) — 실제 Tailwind 클래스와 맞춘다.
const MONTH_HEADER_H = 32 // 날짜 숫자 원형(h-6=24) + mb-1(4) + p-1 top(4)
const MONTH_EVENT_CHIP_H = 22 // 일정 칩 1개(text-xs + py-0.5 + mb-0.5)
const MONTH_DUE_CHIP_H = 24 // 마감 이슈 칩 1개
const MONTH_OVERFLOW_H = 18 // "+N" 표시 줄
const MONTH_CELL_PAD_BOTTOM = 4 // 칸 아래 여백
export const MONTH_MIN_ROW_H = 78 // 행 최소 높이
const MONTH_FALLBACK_FIT = 3 // 측정 전(rowHeight <= 0) 보여 줄 개수

export interface FitMonthCellInput {
  /** 한 행(칸)의 높이(px). 측정 전이면 0 */
  rowHeight: number
  /** 그 날의 일정 수 */
  eventCount: number
  /** 그 날의 마감 이슈 수 */
  dueCount: number
}

export interface FitMonthCellResult {
  visibleEvents: number
  visibleDues: number
  /** 못 보여 "+N" 으로 묶는 개수 */
  overflow: number
}

/**
 * 칸 높이 안에 보일 일정·마감 이슈 개수를 계산한다.
 * 일정이 먼저, 마감 이슈가 그 뒤. 전부 들어가면 전부 보이고, 하나라도 넘치면 "+N" 줄 높이를
 * 미리 빼고 앞쪽 k 개만 보인다(최소 1개). 측정 전에는 앞쪽 3개.
 */
export function fitMonthCell({ rowHeight, eventCount, dueCount }: FitMonthCellInput): FitMonthCellResult {
  const total = eventCount + dueCount
  // 앞에서부터 보일 개수 k — 이후 일정·마감으로 나눈다.
  let k: number
  if (rowHeight <= 0) {
    // 측정 전: 고정 개수
    k = Math.min(total, MONTH_FALLBACK_FIT)
  } else {
    const avail = rowHeight - MONTH_HEADER_H - MONTH_CELL_PAD_BOTTOM
    const sum = eventCount * MONTH_EVENT_CHIP_H + dueCount * MONTH_DUE_CHIP_H
    if (sum <= avail) {
      k = total
    } else {
      // 넘침 — "+N" 줄 자리를 남기고 들어가는 만큼만. 일정(22)을 먼저 채우고 남은 높이에 마감(24)을 채운다.
      // 소수점 높이는 내림으로만 세어 칩을 더 넣지 않는다.
      const limit = avail - MONTH_OVERFLOW_H
      const fitEvents = Math.max(0, Math.min(eventCount, Math.floor(limit / MONTH_EVENT_CHIP_H)))
      const fitDues =
        fitEvents < eventCount
          ? 0 // 일정이 다 못 들어갔으면 마감은 그 뒤라 보이지 않는다
          : Math.max(0, Math.min(dueCount, Math.floor((limit - fitEvents * MONTH_EVENT_CHIP_H) / MONTH_DUE_CHIP_H)))
      // 최소 1개는 보인다
      k = Math.max(fitEvents + fitDues, 1)
    }
  }
  const visibleEvents = Math.min(k, eventCount)
  const visibleDues = k - visibleEvents
  return { visibleEvents, visibleDues, overflow: total - k }
}
