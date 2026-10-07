/**
 * 지수 백오프 간격 — attempt 번째(1부터) 재시도까지 base, 2·base, 4·base … 를 max 로 자른다.
 * attempt 가 1 미만이면 첫 간격(base)으로 본다. 노트 동기화 재접속·제목 저장 재시도가 같은 규칙을 쓴다.
 */
export function backoffDelay(baseMs: number, maxMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs)
}
