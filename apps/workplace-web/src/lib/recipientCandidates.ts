// 새 메시지 "받는 사람" 후보 거르기 — RecipientInput 의 순수 규칙(WP-412 에서 컴포넌트 밖으로 분리).

/**
 * 사용자 검색 결과에서 고를 수 없는 후보를 뺀다 — 제외 대상(본인: self-DM 은 별도 진입점), 비활성 사용자, 이미 고른 상대.
 * 백엔드가 kind·검색어로 이미 좁혔으므로 여기서는 이 세 가지만 거른다.
 */
export function recipientCandidates<T extends { id: number; isActive?: boolean | null }>(
  results: T[],
  excludeUserIds: ReadonlySet<number> | undefined,
  selectedIds: ReadonlySet<number>,
): T[] {
  return results.filter((u) => !excludeUserIds?.has(u.id) && u.isActive !== false && !selectedIds.has(u.id))
}
