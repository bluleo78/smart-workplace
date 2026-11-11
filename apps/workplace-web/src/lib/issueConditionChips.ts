// 이슈 탭 조건 칩(WP-1478) — 빠른 필터 facet 이 없는 조건(오래 멈춤·기다리는 중·마감 기간)을 필터 줄에 지울 수 있는 칩으로 보인다.
// 프로젝트 개요의 「n건 더 — 이슈 탭에서 보기」·마감 임박·기한 지남 링크가 이 조건을 주소에 실어 온다 — 칩이 없으면 걸린 줄 모르고 결과가 왜 적은지 알 수 없다.
import type { IssueFilters } from '../types/issue'
import { formatDateRangeMonthDay } from './formatters'

/** 조건 칩 종류 — 칩 testid·지우기 대상. */
export type IssueConditionKey = 'stale' | 'waiting' | 'due'

/** 칩 하나 — 보일 글. */
export interface IssueConditionChip {
  key: IssueConditionKey
  label: string
}

/**
 * 걸린 조건 칩 — 순서 고정(오래 멈춤 → 기다리는 중 → 마감).
 * 마감: 「마감 ~ 11월 10일」(끝만) / 「마감 11월 11일 ~」(시작만) / 「마감 11월 11일 ~ 11월 17일」. now 는 「올해」 기준(연도 표기).
 */
export function issueConditionChips(f: IssueFilters, now: Date = new Date()): IssueConditionChip[] {
  const chips: IssueConditionChip[] = []
  if (f.stale) chips.push({ key: 'stale', label: '오래 멈춤' })
  if (f.waiting) chips.push({ key: 'waiting', label: '기다리는 중' })
  if (f.dueFrom || f.dueTo) {
    // 날짜 범위 글은 앱 공용 포매터(사이클 행과 같은 열린 범위 모양)를 쓴다.
    chips.push({ key: 'due', label: `마감 ${formatDateRangeMonthDay(f.dueFrom, f.dueTo, '', { openEnded: true, now })}` })
  }
  return chips
}

/** 칩 하나를 지운 필터 — 다른 조건은 그대로. 마감은 시작·끝을 함께 지운다. */
export function withoutCondition(f: IssueFilters, key: IssueConditionKey): IssueFilters {
  if (key === 'due') return { ...f, dueFrom: null, dueTo: null }
  const next = { ...f }
  delete next[key]
  return next
}
