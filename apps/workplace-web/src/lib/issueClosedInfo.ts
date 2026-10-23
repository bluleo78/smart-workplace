import { parseUtcDate } from './formatters'
import { daysUntilLocalDate } from './myTasks'

/** 끝난 이슈의 완료 표기 정보(WP-873) — 상세 줄·목록 셀·카드가 같은 판정을 쓴다. */
export interface ClosedInfo {
  kind: 'done' | 'canceled'
  closedAt: string
  /** DONE 이 마감일보다 늦게 끝났을 때 늦은 일수(1 이상). 당일·조기·마감 없음·취소는 null. */
  lateDays: number | null
}

/** 완료 표기 글리프 — 완료 ✓, 취소 ⊘. 목록 셀·카드·상세 줄이 같은 기호를 쓴다. */
export function closedGlyph(kind: ClosedInfo['kind']): '✓' | '⊘' {
  return kind === 'done' ? '✓' : '⊘'
}

/** 완료 표기 동사 — 「완료」/「취소」. 상세 줄 문구·목록 셀 툴팁 공용. */
export function closedVerb(kind: ClosedInfo['kind']): '완료' | '취소' {
  return kind === 'done' ? '완료' : '취소'
}

/**
 * 종료(DONE·CANCELED) 이슈의 완료 표기 정보. 종료 상태가 아니거나 closedAt 이 없으면(재오픈·구버전 응답·데이터 이상) null —
 * 호출부는 null 이면 기존 마감 표기로 폴백하거나 줄을 생략한다.
 * 늦음은 DONE 만 판정한다: (closedAt 의 브라우저 로컬 날짜 − 마감일) > 0 일 때 그 일수. 취소는 늦음 개념이 없다.
 * 마감일은 날짜 전용 `YYYY-MM-DD` 라 문자열 그대로 분해한다(Date 로 파싱하면 시간대에 따라 하루 밀린다).
 */
export function closedInfo(issue: { status: string; closedAt?: string | null; dueDate: string | null }): ClosedInfo | null {
  if (issue.status !== 'DONE' && issue.status !== 'CANCELED') return null
  if (!issue.closedAt) return null
  const closed = parseUtcDate(issue.closedAt)
  if (Number.isNaN(closed.getTime())) return null
  const kind = issue.status === 'DONE' ? 'done' : 'canceled'
  let lateDays: number | null = null
  // 형식 검사는 여기서 한다 — daysUntilLocalDate 는 입력을 검증하지 않는다.
  if (kind === 'done' && issue.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(issue.dueDate)) {
    // 마감일까지 남은 일수(완료 시각 기준)의 부호를 뒤집으면 늦은 일수 — 로컬 자정끼리 비교라 시각·DST 영향이 없다.
    const diff = -daysUntilLocalDate(issue.dueDate, closed)
    if (diff > 0) lateDays = diff
  }
  return { kind, closedAt: issue.closedAt, lateDays }
}
