// 사이클 순수 규칙 — 목록 모바일 행 2줄째 문구(CyclesPage)·폼 기간 검증(CycleFormDialog). WP-412 에서 컴포넌트 밖으로 분리.
import type { CycleProgress, CycleResponse } from '@/types/cycle'

import { formatDateRangeMonthDay } from './formatters'
import { completionPct } from './progress'

/**
 * 모바일 사이클 행 2줄째 — 「날짜 · 진행」(상태는 1줄째 배지에만, R2).
 * 한쪽 날짜만 있으면 열린 범위(「10월 13일 ~」·「~ 10월 31일」)로, 둘 다 없으면 「—」. 이슈가 0건이면 퍼센트 대신 「이슈 없음」.
 */
export function cycleMetaText(c: Pick<CycleResponse, 'startDate' | 'endDate'>, p: CycleProgress | undefined): string {
  const range = formatDateRangeMonthDay(c.startDate, c.endDate, '—', { openEnded: true })
  const total = p?.total ?? 0
  const progress = total > 0 ? `${completionPct(p?.done ?? 0, total)}%` : '이슈 없음'
  return `${range} · ${progress}`
}

/**
 * 종료일이 시작일보다 빠른가(#804). 둘 중 하나라도 비어 있으면 검증하지 않는다(기간 미정 사이클 허용).
 * 값은 yyyy-MM-dd(HTML date input) 라 문자열 비교가 곧 날짜 비교다.
 */
export function isCycleDateRangeInvalid(startDate: string, endDate: string): boolean {
  return Boolean(startDate && endDate && endDate < startDate)
}

/**
 * 이슈 사이클 피커에서 이 사이클을 고를 수 있는가(WP-659). 완료 사이클에는 새로 붙일 수 없다(서버 replace·move 와 같은 규칙) —
 * 다만 이미 붙어 있던 완료 사이클은 떼거나 다시 체크할 수 있게 둔다(완료 전에 배정된 기록).
 */
export function canPickCycle(c: Pick<CycleResponse, 'id' | 'status'>, attachedIds: ReadonlySet<number>): boolean {
  return c.status !== 'COMPLETED' || attachedIds.has(c.id)
}
