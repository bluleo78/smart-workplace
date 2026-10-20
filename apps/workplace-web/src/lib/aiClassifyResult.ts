// 이슈 상세 AI 분류 제안 적용 결과 → 통합 토스트 문구(#578·WP-503).
// 왜: 우선순위·유형·라벨 변경을 allSettled 로 기다린 뒤 결과와 상관없이 「적용했습니다」를 띄워, 셋 다 실패해도 성공처럼 보였다.
// 개별 실패는 각 훅의 onError 가 이미 에러 토스트로 알리므로 여기서는 성공 몇 건인지만 본다.
// lib/bulkResult 의 bulkResultToast 를 쓰지 않는 이유: 그쪽은 실패 시 에러 토스트를 내(훅 토스트와 중복) 건수 문구를 쓰고,
// patch 가 실패를 reject 대신 false 로 돌려주는 경우를 성공으로 센다.

/**
 * 적용 결과로 성공 토스트 문구를 정한다 — 하나도 적용되지 않았으면 null(성공 토스트를 띄우지 않는다).
 * 이슈 PATCH(patch)는 실패해도 reject 대신 false 로 끝나므로 fulfilled 이면서 false 가 아닌 것만 성공으로 센다.
 */
export function aiClassifyApplyToast(results: readonly PromiseSettledResult<unknown>[]): string | null {
  const applied = results.filter((r) => r.status === 'fulfilled' && r.value !== false).length
  if (applied === 0) return null
  return applied === results.length ? 'AI 제안을 적용했습니다' : 'AI 제안 일부만 적용했습니다'
}
