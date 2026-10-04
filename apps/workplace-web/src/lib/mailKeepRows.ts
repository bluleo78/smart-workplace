// "안 읽은 메일만" 보기에서 연 메일 유지(WP-186) — 읽음이 되어 서버 결과에서 빠져도, 보기·토글을 바꾸기 전까지는 목록에서 빼지 않는다(Gmail 방식).
// 60초 주기·포커스 재조회가 행을 지워 읽는 도중 목록이 흔들리는 것을 막는다.
import type { EmailMessageSummary } from '@/types/mailMessage'

/** next 에 없는 keptRows(선택 시점 스냅샷)를 끼워 수신 시각 내림차순(동률은 id 내림차순)으로 정렬한다. 서버 행이 있으면 서버 행이 우선. */
export function mergeKeptRows(
  next: EmailMessageSummary[] | undefined,
  keptRows: ReadonlyMap<number, EmailMessageSummary> | undefined,
): EmailMessageSummary[] | undefined {
  if (!next) return undefined
  if (!keptRows || keptRows.size === 0) return next
  const present = new Set(next.map((r) => r.id))
  const revived = [...keptRows.values()].filter((r) => !present.has(r.id))
  if (revived.length === 0) return next
  const t = (r: EmailMessageSummary) => (r.receivedAt ? Date.parse(r.receivedAt) : 0)
  return [...next, ...revived].sort((a, b) => t(b) - t(a) || b.id - a.id)
}

/** 유지 스냅샷의 seen 을 바꾼 새 Map — ids 에 있는 행만('all' 이면 전부). 없는 id 는 무시한다(행을 새로 넣지 않는다). */
export function markSeenInKept(
  kept: ReadonlyMap<number, EmailMessageSummary>,
  ids: readonly number[] | 'all',
  seen: boolean,
): Map<number, EmailMessageSummary> {
  const target = ids === 'all' ? null : new Set(ids)
  return new Map([...kept].map(([id, r]) => [id, !target || target.has(id) ? { ...r, seen } : r]))
}

/** 열린 메일 행(선택 시점 스냅샷)을 끼운 유지 스냅샷(WP-230) — 이미 유지 중이거나 row 가 없으면 kept 그대로. 원본은 건드리지 않는다. */
export function withOpenRow(
  kept: ReadonlyMap<number, EmailMessageSummary> | undefined,
  row: EmailMessageSummary | undefined,
): ReadonlyMap<number, EmailMessageSummary> | undefined {
  if (!row || kept?.has(row.id)) return kept
  return new Map(kept).set(row.id, row)
}
