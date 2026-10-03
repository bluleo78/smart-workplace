// "안 읽은 메일만" 보기에서 연 메일 유지(WP-186) — 읽음이 되어 서버 결과에서 빠져도, 보기·토글을 바꾸기 전까지는 목록에서 빼지 않는다(Gmail 방식).
// 60초 주기·포커스 재조회가 행을 지워 읽는 도중 목록이 흔들리는 것을 막는다.
import type { EmailMessageSummary } from '@/types/mailMessage'

/** next 에 없는 keepIds 행을 prev 에서 가져와 수신 시각 내림차순(동률은 id 내림차순)으로 끼운다. */
export function mergeKeptRows(
  next: EmailMessageSummary[] | undefined,
  prev: EmailMessageSummary[],
  keepIds: ReadonlySet<number>,
): EmailMessageSummary[] | undefined {
  if (!next) return undefined
  const present = new Set(next.map((r) => r.id))
  const revived = prev.filter((r) => keepIds.has(r.id) && !present.has(r.id))
  if (revived.length === 0) return next
  const t = (r: EmailMessageSummary) => (r.receivedAt ? Date.parse(r.receivedAt) : 0)
  return [...next, ...revived].sort((a, b) => t(b) - t(a) || b.id - a.id)
}
